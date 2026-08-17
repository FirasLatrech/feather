//! Folder watcher: auto-compress new files dropped into configured folders.
use super::jobs::JobManager;
use super::probe::{kind_from_ext, probe, MediaKind};
use super::settings::Settings;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};

pub struct Watcher {
    inner: Mutex<Option<RecommendedWatcher>>,
    stop: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

impl Watcher {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None), stop: Mutex::new(None) }
    }

    /// (Re)start watching according to `settings.watch`. Idempotent.
    pub async fn apply(&self, settings: Arc<Mutex<Settings>>, mgr: JobManager) {
        // Stop the previous watcher & task.
        if let Some(tx) = self.stop.lock().await.take() {
            let _ = tx.send(true);
        }
        *self.inner.lock().await = None;

        let ws = settings.lock().await.watch.clone();
        if !ws.enabled || ws.folders.is_empty() {
            return;
        }
        let (tx, mut rx) = mpsc::unbounded_channel::<PathBuf>();
        let mut w = match RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(ev) = res {
                    if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                        for p in ev.paths {
                            let _ = tx.send(p);
                        }
                    }
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher init failed: {e}");
                return;
            }
        };
        for f in &ws.folders {
            let p = Path::new(f);
            if p.is_dir() {
                if let Err(e) = w.watch(p, RecursiveMode::NonRecursive) {
                    eprintln!("cannot watch {f}: {e}");
                }
            }
        }
        *self.inner.lock().await = Some(w);

        let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
        *self.stop.lock().await = Some(stop_tx);
        let settle = Duration::from_secs(ws.settle_secs.max(1) as u64);
        let allowed = move |k: MediaKind| match k {
            MediaKind::Video => ws.videos,
            MediaKind::Image => ws.images,
            MediaKind::Gif => ws.gifs,
            MediaKind::Pdf => ws.pdfs,
            MediaKind::Unknown => false,
        };

        tokio::spawn(async move {
            // path -> (last event time, last size)
            let mut pending: HashMap<PathBuf, (Instant, u64)> = HashMap::new();
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    Some(p) = rx.recv() => {
                        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if name.starts_with('.') || !p.is_file() || !allowed(kind_from_ext(&p)) { continue; }
                        // Browsers download to temp names (.crdownload/.part) then rename → Create of final name.
                        if name.ends_with(".crdownload") || name.ends_with(".part") || name.ends_with(".download") { continue; }
                        if mgr.was_produced(&p).await { continue; }
                        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                        pending.insert(p, (Instant::now(), size));
                    }
                    _ = tick.tick() => {
                        let now = Instant::now();
                        let ready: Vec<PathBuf> = pending.iter()
                            .filter(|(p, (t, sz))| now.duration_since(*t) >= settle && std::fs::metadata(p).map(|m| m.len() == *sz && m.len() > 0).unwrap_or(false))
                            .map(|(p, _)| p.clone()).collect();
                        // Refresh size for still-growing files so settle restarts.
                        for (p, (t, sz)) in pending.iter_mut() {
                            if let Ok(m) = std::fs::metadata(p) { if m.len() != *sz { *sz = m.len(); *t = now; } }
                        }
                        for p in ready {
                            pending.remove(&p);
                            if mgr.was_produced(&p).await { continue; }
                            let tools = mgr.tools().await;
                            match probe(&tools, &p).await {
                                Ok(info) => {
                                    let s = settings.lock().await.clone();
                                    mgr.enqueue(vec![(info, s)]).await;
                                }
                                Err(e) => eprintln!("watch probe failed for {}: {e}", p.display()),
                            }
                        }
                        // Drop stale entries (file vanished)
                        pending.retain(|p, _| p.exists());
                    }
                }
            }
        });
    }
}
