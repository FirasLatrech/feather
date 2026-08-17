use super::probe::{MediaInfo, MediaKind};
use super::settings::Settings;
use super::tools::Tools;
use super::run::{self, DoneInfo};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Notify, RwLock, Semaphore};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: Uuid,
    pub input: MediaInfo,
    pub output_path: Option<String>,
    pub status: JobStatus,
    /// 0..100
    pub progress: f32,
    pub output_size: Option<u64>,
    pub output_width: Option<u32>,
    pub output_height: Option<u32>,
    pub error: Option<String>,
    pub elapsed_ms: Option<u64>,
    pub finished_at: Option<i64>,
    /// output ended up larger than input
    pub larger: bool,
    /// encode speed relative to realtime (ffmpeg `speed=`), while running
    pub speed: Option<f32>,
    /// estimated seconds remaining, while running
    pub eta_secs: Option<f64>,
    /// per-job settings snapshot (so per-file overrides are honoured)
    #[serde(skip)]
    pub settings: Option<Arc<Settings>>,
}

struct Entry {
    job: Job,
    cancel: Arc<Notify>,
    cancelled: Arc<AtomicBool>,
}

struct Inner {
    app: AppHandle,
    jobs: Mutex<Vec<Entry>>,
    /// Output paths we wrote recently — the folder watcher must never re-compress these.
    produced: Mutex<Vec<(PathBuf, Instant)>>,
    sem: RwLock<Arc<Semaphore>>,
    pub tools: RwLock<Tools>,
    history_path: PathBuf,
}

#[derive(Clone)]
pub struct JobManager(Arc<Inner>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: Uuid,
    pub input_path: String,
    pub input_name: String,
    pub kind: MediaKind,
    pub output_path: String,
    pub input_size: u64,
    pub output_size: u64,
    pub finished_at: i64,
    pub elapsed_ms: u64,
}

impl JobManager {
    pub fn new(app: AppHandle, tools: Tools, concurrency: usize, history_path: PathBuf) -> Self {
        Self(Arc::new(Inner {
            app,
            jobs: Mutex::new(Vec::new()),
            produced: Mutex::new(Vec::new()),
            sem: RwLock::new(Arc::new(Semaphore::new(concurrency.max(1)))),
            tools: RwLock::new(tools),
            history_path,
        }))
    }

    pub async fn mark_produced(&self, p: &Path) {
        let mut v = self.0.produced.lock().await;
        v.retain(|(_, t)| t.elapsed() < std::time::Duration::from_secs(3600));
        v.push((p.to_path_buf(), Instant::now()));
    }
    pub async fn was_produced(&self, p: &Path) -> bool {
        self.0.produced.lock().await.iter().any(|(q, _)| q == p)
    }

    pub async fn set_tools(&self, t: Tools) {
        *self.0.tools.write().await = t;
    }
    pub async fn tools(&self) -> Tools {
        self.0.tools.read().await.clone()
    }

    pub async fn set_concurrency(&self, n: usize) {
        *self.0.sem.write().await = Arc::new(Semaphore::new(n.max(1)));
    }

    pub async fn list(&self) -> Vec<Job> {
        self.0.jobs.lock().await.iter().map(|e| e.job.clone()).collect()
    }

    pub async fn clear_finished(&self) {
        let mut jobs = self.0.jobs.lock().await;
        jobs.retain(|e| matches!(e.job.status, JobStatus::Queued | JobStatus::Running));
        drop(jobs);
        let _ = self.0.app.emit("jobs:changed", ());
    }

    pub async fn remove(&self, id: Uuid) {
        self.cancel(id).await;
        let mut jobs = self.0.jobs.lock().await;
        jobs.retain(|e| e.job.id != id);
        drop(jobs);
        let _ = self.0.app.emit("jobs:changed", ());
    }

    pub async fn cancel(&self, id: Uuid) {
        let jobs = self.0.jobs.lock().await;
        if let Some(e) = jobs.iter().find(|e| e.job.id == id) {
            e.cancelled.store(true, Ordering::SeqCst);
            e.cancel.notify_waiters();
            e.cancel.notify_one();
        }
    }

    pub async fn cancel_all(&self) {
        let jobs = self.0.jobs.lock().await;
        for e in jobs.iter() {
            if matches!(e.job.status, JobStatus::Queued | JobStatus::Running) {
                e.cancelled.store(true, Ordering::SeqCst);
                e.cancel.notify_waiters();
                e.cancel.notify_one();
            }
        }
    }

    /// Enqueue jobs. Each input may carry its own settings override.
    pub async fn enqueue(&self, inputs: Vec<(MediaInfo, Settings)>) -> Vec<Job> {
        let mut created = Vec::new();
        {
            let mut jobs = self.0.jobs.lock().await;
            for (info, settings) in inputs {
                let job = Job {
                    id: Uuid::new_v4(),
                    input: info,
                    output_path: None,
                    status: JobStatus::Queued,
                    progress: 0.0,
                    output_size: None,
                    output_width: None,
                    output_height: None,
                    error: None,
                    elapsed_ms: None,
                    finished_at: None,
                    larger: false,
                    speed: None,
                    eta_secs: None,
                    settings: Some(Arc::new(settings)),
                };
                created.push(job.clone());
                jobs.push(Entry { job, cancel: Arc::new(Notify::new()), cancelled: Arc::new(AtomicBool::new(false)) });
            }
        }
        let _ = self.0.app.emit("jobs:changed", ());
        for job in &created {
            let mgr = self.clone();
            let id = job.id;
            tokio::spawn(async move { mgr.run(id).await });
        }
        created
    }

    async fn update<F: FnOnce(&mut Job)>(&self, id: Uuid, f: F) {
        let mut jobs = self.0.jobs.lock().await;
        if let Some(e) = jobs.iter_mut().find(|e| e.job.id == id) {
            f(&mut e.job);
            let _ = self.0.app.emit("job:update", &e.job);
        }
    }

    async fn get(&self, id: Uuid) -> Option<(Job, Arc<Notify>, Arc<AtomicBool>)> {
        let jobs = self.0.jobs.lock().await;
        jobs.iter().find(|e| e.job.id == id).map(|e| (e.job.clone(), e.cancel.clone(), e.cancelled.clone()))
    }

    async fn run(&self, id: Uuid) {
        let sem = self.0.sem.read().await.clone();
        let Some((job, cancel, cancelled)) = self.get(id).await else { return };
        // Wait for a slot, unless cancelled while queued.
        let permit = tokio::select! {
            p = sem.acquire_owned() => p,
            _ = cancel.notified() => { self.update(id, |j| j.status = JobStatus::Cancelled).await; return; }
        };
        let _permit = match permit { Ok(p) => p, Err(_) => return };
        if cancelled.load(Ordering::SeqCst) {
            self.update(id, |j| j.status = JobStatus::Cancelled).await;
            return;
        }
        self.update(id, |j| { j.status = JobStatus::Running; j.progress = 0.0; }).await;
        let start = Instant::now();
        let settings = job.settings.clone().unwrap_or_else(|| Arc::new(Settings::default()));
        let tools = self.tools().await;
        let result = self.execute(&job, &settings, &tools, cancel.clone(), cancelled.clone()).await;
        let elapsed = start.elapsed().as_millis() as u64;
        match result {
            Ok(done) => {
                let hist = HistoryItem {
                    id,
                    input_path: job.input.path.clone(),
                    input_name: job.input.name.clone(),
                    kind: job.input.kind,
                    output_path: done.path.to_string_lossy().to_string(),
                    input_size: job.input.size,
                    output_size: done.size,
                    finished_at: chrono::Utc::now().timestamp_millis(),
                    elapsed_ms: elapsed,
                };
                self.append_history(&hist);
                self.update(id, |j| {
                    j.status = JobStatus::Done;
                    j.progress = 100.0;
                    j.output_path = Some(done.path.to_string_lossy().to_string());
                    j.output_size = Some(done.size);
                    j.output_width = done.dims.map(|d| d.0);
                    j.output_height = done.dims.map(|d| d.1);
                    j.larger = done.size >= j.input.size;
                    j.elapsed_ms = Some(elapsed);
                    j.finished_at = Some(hist.finished_at);
                })
                .await;
            }
            Err(e) => {
                let was_cancelled = cancelled.load(Ordering::SeqCst);
                self.update(id, |j| {
                    j.status = if was_cancelled { JobStatus::Cancelled } else { JobStatus::Failed };
                    j.error = if was_cancelled { None } else { Some(e) };
                    j.elapsed_ms = Some(elapsed);
                })
                .await;
            }
        }
    }

    async fn execute(
        &self,
        job: &Job,
        s: &Settings,
        tools: &Tools,
        cancel: Arc<Notify>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<DoneInfo, String> {
        let id = job.id;
        // Register the input up-front so a folder watcher never re-queues a file we're replacing.
        self.mark_produced(Path::new(&job.input.path)).await;
        let mgr = self.clone();
        let progress = move |p: f32, speed: Option<f32>, eta: Option<f64>| {
            let mgr = mgr.clone();
            tokio::spawn(async move {
                mgr.update(id, |j| { j.progress = p.clamp(0.0, 99.9); j.speed = speed; j.eta_secs = eta; }).await
            });
        };
        let mgr2 = self.clone();
        let output_path = move |p: &Path| {
            let mgr = mgr2.clone();
            let ps = p.to_string_lossy().to_string();
            let pb = p.to_path_buf();
            tokio::spawn(async move {
                mgr.mark_produced(&pb).await;
                mgr.update(id, |j| j.output_path = Some(ps)).await;
            });
        };
        run::run_compression(tools, &job.input, s, run::Hooks { progress: &progress, output_path: &output_path }, cancel, cancelled).await
    }


    fn append_history(&self, item: &HistoryItem) {
        let mut items = self.read_history();
        items.push(item.clone());
        if items.len() > 5000 {
            let n = items.len() - 5000;
            items.drain(0..n);
        }
        if let Some(p) = self.0.history_path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let _ = std::fs::write(&self.0.history_path, serde_json::to_vec(&items).unwrap_or_default());
    }

    pub fn read_history(&self) -> Vec<HistoryItem> {
        std::fs::read(&self.0.history_path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn clear_history(&self) {
        let _ = std::fs::remove_file(&self.0.history_path);
    }
}
