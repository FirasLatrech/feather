//! Tauri-free compression runner: takes probed media + settings, produces an output file.
//! Used by the app's JobManager and by the `feather-cli` binary / MCP server.
use super::probe::{MediaInfo, MediaKind};
use super::settings::{Quality, Settings};
use super::tools::Tools;
use super::{gif, image_enc, output, pdf, video};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

pub struct DoneInfo {
    pub path: PathBuf,
    pub size: u64,
    pub dims: Option<(u32, u32)>,
}

/// Progress callback: (percent 0..100, speed × realtime, eta seconds).
pub type ProgressFn = dyn Fn(f32, Option<f32>, Option<f64>) + Send + Sync;
/// Called once the destination path is known (before encoding starts).
pub type OutputPathFn = dyn Fn(&Path) + Send + Sync;

pub struct Hooks<'a> {
    pub progress: &'a ProgressFn,
    pub output_path: &'a OutputPathFn,
}

/// Compress one file. Cancellation: notify `cancel` and set `cancelled`.
pub async fn run_compression(
    tools: &Tools,
    info: &MediaInfo,
    s: &Settings,
    hooks: Hooks<'_>,
    cancel: Arc<Notify>,
    cancelled: Arc<AtomicBool>,
) -> Result<DoneInfo, String> {
    let progress = |p: f32, sp: Option<f32>, eta: Option<f64>| (hooks.progress)(p, sp, eta);
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
    (hooks.output_path)(&final_path);

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
                let log = std::env::temp_dir().join(format!("feather-pass-{}", uuid::Uuid::new_v4().simple()));
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
            progress(15.0, None, None);
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
        (hooks.output_path)(&final_real);
    }
    Ok(DoneInfo { path: final_real, size, dims })
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
    progress: &(dyn Fn(f32, Option<f32>, Option<f64>) + Send + Sync),
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
    let mut speed: Option<f32> = None;
    let mut out_us: i64 = 0;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        if let Some(v) = l.strip_prefix("speed=") {
                            speed = v.trim().trim_end_matches('x').parse::<f32>().ok().filter(|s| *s > 0.0);
                        } else if let Some(v) = l.strip_prefix("out_time_us=").or_else(|| l.strip_prefix("out_time_ms=")) {
                            if let Ok(us) = v.trim().parse::<i64>() { out_us = us.max(0); }
                        } else if l.starts_with("progress=") {
                            // One block per progress tick; emit once per block.
                            if let Some(d) = duration.filter(|d| *d > 0.0) {
                                if last_emit.elapsed().as_millis() > 150 {
                                    let done_s = (out_us as f64) / 1_000_000.0;
                                    let frac = (done_s / d).clamp(0.0, 1.0) as f32;
                                    // ETA covers the remaining share of *this* pass plus any following pass.
                                    let passes_left = ((100.0 - to) / (to - from).max(1.0)) as f64;
                                    let eta = speed.map(|sp| ((d - done_s).max(0.0) + passes_left * d) / sp as f64);
                                    progress(from + (to - from) * frac, speed, eta);
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
    progress: &(dyn Fn(f32, Option<f32>, Option<f64>) + Send + Sync),
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
                            progress((page as f32 / total as f32) * 100.0, None, None);
                        } else {
                            progress(((page as f32) * 3.0).min(90.0), None, None);
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

