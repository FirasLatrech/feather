use super::probe::{MediaInfo, MediaKind};
use super::settings::{Quality, Settings};
use super::tools::Tools;
use super::{gif, image_enc, output, pdf, video};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
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
            sem: RwLock::new(Arc::new(Semaphore::new(concurrency.max(1)))),
            tools: RwLock::new(tools),
            history_path,
        }))
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
        let info = &job.input;
        let id = job.id;
        let input_path = PathBuf::from(&info.path);
        if !input_path.exists() {
            return Err("input file no longer exists".into());
        }

        // Plan output
        let (ext, quality, codec_label, resolution): (&str, Quality, &str, Option<(u32, u32)>) = match info.kind {
            MediaKind::Video => {
                let p = video::plan(info, &s.video);
                if p.ext == "gif" {
                    ("gif", s.gif.quality, "gif", gif::resolution(info, &s.gif))
                } else {
                    (p.ext, s.video.quality, p.codec_label, p.resolution)
                }
            }
            MediaKind::Gif => ("gif", s.gif.quality, "gif", gif::resolution(info, &s.gif)),
            MediaKind::Image => (image_enc::output_ext(info, &s.image), s.image.quality, "", info.width.zip(info.height).and_then(|(w, h)| s.image.resize.target(w, h))),
            MediaKind::Pdf => ("pdf", s.pdf.quality, "gs", None),
            MediaKind::Unknown => return Err("unsupported file type".into()),
        };
        let final_path = output::resolve_output(info, &s.output, quality, codec_label, ext, resolution)?;
        let tmp = output::temp_path_for(&final_path);
        if let Some(dir) = tmp.parent() {
            output::sweep_temps(dir, std::time::Duration::from_secs(6 * 3600));
        }
        self.update(id, |j| j.output_path = Some(final_path.to_string_lossy().to_string())).await;

        let mgr = self.clone();
        let progress = move |p: f32| {
            let mgr = mgr.clone();
            tokio::spawn(async move { mgr.update(id, |j| j.progress = p.clamp(0.0, 99.9)).await });
        };

        let run_res: Result<Option<(u32, u32)>, String> = match info.kind {
            MediaKind::Video if ext == "gif" => {
                let trim = s.video.trim_start.map(|st| (st, s.video.trim_end)).or(s.video.trim_end.map(|en| (0.0, Some(en))));
                let args = gif::build_args(info, &s.gif, &tmp, trim);
                let dur = effective_duration(info, &s.video);
                run_ffmpeg(tools.ffmpeg()?, &args, dur, 0.0, 100.0, &progress, &cancel, &cancelled).await.map(|_| resolution)
            }
            MediaKind::Video if ext == "mp3" => {
                let args = video::build_args(info, &s.video, &tmp, 0, None);
                let dur = effective_duration(info, &s.video);
                run_ffmpeg(tools.ffmpeg()?, &args, dur, 0.0, 100.0, &progress, &cancel, &cancelled).await.map(|_| None)
            }
            MediaKind::Video => {
                let p = video::plan(info, &s.video);
                let dur = effective_duration(info, &s.video);
                let ff = tools.ffmpeg()?;
                if p.two_pass {
                    let log = std::env::temp_dir().join(format!("feather-pass-{}", id.simple()));
                    let a1 = video::build_args(info, &s.video, &tmp, 1, Some(&log));
                    let r1 = run_ffmpeg(ff, &a1, dur, 0.0, 50.0, &progress, &cancel, &cancelled).await;
                    let r = match r1 {
                        Ok(_) => {
                            let a2 = video::build_args(info, &s.video, &tmp, 2, Some(&log));
                            run_ffmpeg(ff, &a2, dur, 50.0, 100.0, &progress, &cancel, &cancelled).await
                        }
                        Err(e) => Err(e),
                    };
                    // cleanup pass logs
                    if let Some(parent) = log.parent() {
                        if let Ok(rd) = std::fs::read_dir(parent) {
                            let prefix = log.file_name().unwrap().to_string_lossy().to_string();
                            for f in rd.flatten() {
                                if f.file_name().to_string_lossy().starts_with(&prefix) {
                                    let _ = std::fs::remove_file(f.path());
                                }
                            }
                        }
                    }
                    r.map(|_| p.resolution.or(info.width.zip(info.height)))
                } else {
                    let args = video::build_args(info, &s.video, &tmp, 0, None);
                    run_ffmpeg(ff, &args, dur, 0.0, 100.0, &progress, &cancel, &cancelled).await.map(|_| p.resolution.or(info.width.zip(info.height)))
                }
            }
            MediaKind::Gif => {
                let args = gif::build_args(info, &s.gif, &tmp, None);
                run_ffmpeg(tools.ffmpeg()?, &args, info.duration, 0.0, 100.0, &progress, &cancel, &cancelled).await.map(|_| resolution.or(info.width.zip(info.height)))
            }
            MediaKind::Image => {
                let tools2 = tools.clone();
                let info2 = info.clone();
                let s2 = s.image.clone();
                let tmp2 = tmp.clone();
                progress(15.0);
                // Image encoding is CPU-bound and can't be interrupted; wait for it, then discard if cancelled.
                let handle = tokio::task::spawn_blocking(move || image_enc::compress(&tools2, &info2, &s2, &tmp2));
                let r = handle.await.map_err(|e| e.to_string()).and_then(|r| r).map(Some);
                if cancelled.load(Ordering::SeqCst) { Err("cancelled".into()) } else { r }
            }
            MediaKind::Pdf => {
                let gs = tools.gs()?;
                let pages = pdf_page_count(gs, &input_path).await;
                let args = pdf::build_args(&input_path, &tmp, s.pdf.quality);
                run_gs(gs, &args, pages, &progress, &cancel, &cancelled).await.map(|_| None)
            }
            MediaKind::Unknown => Err("unsupported".into()),
        };

        if let Err(e) = run_res {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        let dims = run_res.unwrap();

        // Finalize (pure fs logic; unit-tested in output.rs)
        let (final_real, size) = output::finalize(&input_path, &tmp, &final_path, ext, &s.output, info.size)?;
        if final_real != final_path {
            let fr = final_real.to_string_lossy().to_string();
            self.update(id, |j| j.output_path = Some(fr)).await;
        }
        Ok(DoneInfo { path: final_real, size, dims })
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

struct DoneInfo {
    path: PathBuf,
    size: u64,
    dims: Option<(u32, u32)>,
}

fn effective_duration(info: &MediaInfo, v: &super::settings::VideoSettings) -> Option<f64> {
    let d = info.duration?;
    let st = v.trim_start.unwrap_or(0.0).max(0.0);
    let en = v.trim_end.unwrap_or(d).min(d);
    Some((en - st).max(0.01))
}

fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Runs ffmpeg with `-progress pipe:1`, mapping out_time to [from,to] progress range.
#[allow(clippy::too_many_arguments)]
async fn run_ffmpeg(
    ffmpeg: &Path,
    args: &[String],
    duration: Option<f64>,
    from: f32,
    to: f32,
    progress: &(dyn Fn(f32) + Send + Sync),
    cancel: &Notify,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to start ffmpeg: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut rd = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = rd.next_line().await {
            buf.push_str(&l);
            buf.push('\n');
            if buf.len() > 64 * 1024 { buf.drain(0..32 * 1024); }
        }
        buf
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut last_emit = Instant::now();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        if let Some(v) = l.strip_prefix("out_time_us=").or_else(|| l.strip_prefix("out_time_ms=")) {
                            if let (Ok(us), Some(d)) = (v.trim().parse::<i64>(), duration) {
                                if d > 0.0 && us >= 0 && last_emit.elapsed().as_millis() > 120 {
                                    let frac = ((us as f64) / 1_000_000.0 / d).clamp(0.0, 1.0) as f32;
                                    progress(from + (to - from) * frac);
                                    last_emit = Instant::now();
                                }
                            }
                        }
                    }
                    _ => break,
                }
            }
            _ = cancel.notified() => {
                let _ = child.kill().await;
                return Err("cancelled".into());
            }
        }
    }
    let status = tokio::select! {
        s = child.wait() => s.map_err(|e| e.to_string())?,
        _ = cancel.notified() => { let _ = child.kill().await; return Err("cancelled".into()); }
    };
    let err = err_task.await.unwrap_or_default();
    if cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    if status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg failed ({}):\n{}", status.code().unwrap_or(-1), tail(&err, 8)))
    }
}

async fn pdf_page_count(gs: &Path, input: &Path) -> Option<u32> {
    let script = format!("({}) (r) file runpdfbegin pdfpagecount = quit", input.to_string_lossy().replace('\\', "/").replace('(', "\\(").replace(')', "\\)"));
    let out = Command::new(gs)
        .args(["-q", "-dNODISPLAY", "-dNOSAFER", "-c", &script])
        .output()
        .await
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().lines().last()?.trim().parse().ok()
}

async fn run_gs(
    gs: &Path,
    args: &[String],
    pages: Option<u32>,
    progress: &(dyn Fn(f32) + Send + Sync),
    cancel: &Notify,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut child = Command::new(gs)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to start ghostscript: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let err_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut rd = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = rd.next_line().await { buf.push_str(&l); buf.push('\n'); }
        buf
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut out_buf = String::new();
    let mut page = 0u32;
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    out_buf.push_str(&l); out_buf.push('\n');
                    if l.trim_start().starts_with("Page ") {
                        page += 1;
                        if let Some(total) = pages.filter(|t| *t > 0) {
                            progress((page as f32 / total as f32) * 100.0);
                        } else {
                            progress(((page as f32) * 3.0).min(90.0));
                        }
                    }
                }
                _ => break,
            },
            _ = cancel.notified() => { let _ = child.kill().await; return Err("cancelled".into()); }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let err = err_task.await.unwrap_or_default();
    if cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    if status.success() {
        Ok(())
    } else {
        Err(format!("ghostscript failed:\n{}", tail(&format!("{out_buf}\n{err}"), 8)))
    }
}
