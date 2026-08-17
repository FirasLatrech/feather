//! End-to-end tests of the encoding pipeline against real ffmpeg / gs binaries.
//! Requires sample files in FEATHER_SAMPLES (dir) — skipped otherwise.
use feather_lib::engine::probe::{probe, MediaKind};
use feather_lib::engine::settings::*;
use feather_lib::engine::{gif, image_enc, pdf, video, Tools};
use std::path::{Path, PathBuf};
use std::process::Command;

fn samples() -> Option<PathBuf> {
    std::env::var("FEATHER_SAMPLES").ok().map(PathBuf::from).filter(|p| p.exists())
}
fn out_dir() -> PathBuf {
    let d = std::env::temp_dir().join("feather-test-out");
    std::fs::create_dir_all(&d).unwrap();
    d
}
fn run(bin: &Path, args: &[String]) -> (bool, String) {
    let o = Command::new(bin).args(args).output().unwrap();
    (o.status.success(), String::from_utf8_lossy(&o.stderr).to_string())
}
fn ffprobe_ok(tools: &Tools, p: &Path) -> bool {
    Command::new(tools.ffprobe().unwrap()).args(["-v", "error"]).arg(p).output().map(|o| o.status.success()).unwrap_or(false)
}

#[tokio::test]
async fn video_h264_crf() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let info = probe(&tools, &s.join("sample.mp4")).await.unwrap();
    assert_eq!(info.kind, MediaKind::Video);
    assert!(info.has_audio);
    assert_eq!(info.width, Some(1280));
    let vs = VideoSettings { quality: Quality::Good, resize: Resize { mode: ResizeMode::Width, value: 640 }, ..Default::default() };
    let out = out_dir().join("h264.mp4");
    let args = video::build_args(&info, &vs, &out, 0, None);
    let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
    assert!(ok, "ffmpeg failed: {err}\nargs: {args:?}");
    let o = probe(&tools, &out).await.unwrap();
    assert_eq!(o.width, Some(640));
    assert!(o.has_audio);
    assert!(o.size < info.size, "output not smaller: {} vs {}", o.size, info.size);
}

#[tokio::test]
async fn video_h265_two_pass_target_size() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let info = probe(&tools, &s.join("sample.mp4")).await.unwrap();
    let vs = VideoSettings { codec: VideoCodec::H265, target_size_mb: Some(0.1), ..Default::default() };
    let out = out_dir().join("h265.mp4");
    let log = out_dir().join("passlog");
    let a1 = video::build_args(&info, &vs, &out, 1, Some(&log));
    let (ok, err) = run(tools.ffmpeg().unwrap(), &a1);
    assert!(ok, "pass1 failed: {err}\n{a1:?}");
    let a2 = video::build_args(&info, &vs, &out, 2, Some(&log));
    let (ok, err) = run(tools.ffmpeg().unwrap(), &a2);
    assert!(ok, "pass2 failed: {err}\n{a2:?}");
    let o = probe(&tools, &out).await.unwrap();
    assert_eq!(o.video_codec.as_deref(), Some("hevc"));
    // within 35% of target
    let target = 0.1 * 1024.0 * 1024.0;
    assert!((o.size as f64) < target * 1.35, "size {} too far from target {}", o.size, target);
}

#[tokio::test]
async fn video_webm_vp9_and_av1_and_hw() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let info = probe(&tools, &s.join("sample.mp4")).await.unwrap();
    for (codec, fmt, name) in [(VideoCodec::Vp9, VideoFormat::Webm, "vp9.webm"), (VideoCodec::Av1, VideoFormat::Mp4, "av1.mp4")] {
        let vs = VideoSettings { codec, format: fmt, quality: Quality::Acceptable, trim_start: Some(1.0), trim_end: Some(3.0), ..Default::default() };
        let out = out_dir().join(name);
        let args = video::build_args(&info, &vs, &out, 0, None);
        let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
        assert!(ok, "{name} failed: {err}\n{args:?}");
        let o = probe(&tools, &out).await.unwrap();
        assert!(o.duration.unwrap() > 1.5 && o.duration.unwrap() < 2.5, "trim wrong: {:?}", o.duration);
    }
    if cfg!(target_os = "macos") {
        let vs = VideoSettings { codec: VideoCodec::H265, hw_accel: true, ..Default::default() };
        let out = out_dir().join("hw.mp4");
        let args = video::build_args(&info, &vs, &out, 0, None);
        let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
        assert!(ok, "hw failed: {err}\n{args:?}");
        assert!(ffprobe_ok(&tools, &out));
    }
}

#[tokio::test]
async fn video_to_gif_and_mp3() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let info = probe(&tools, &s.join("sample.mp4")).await.unwrap();
    let out = out_dir().join("v.gif");
    let args = gif::build_args(&info, &GifSettings::default(), &out, Some((0.0, Some(2.0))));
    let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
    assert!(ok, "gif failed: {err}\n{args:?}");
    let o = probe(&tools, &out).await.unwrap();
    assert_eq!(o.width, Some(640));

    let vs = VideoSettings { format: VideoFormat::Mp3, ..Default::default() };
    let out = out_dir().join("a.mp3");
    let args = video::build_args(&info, &vs, &out, 0, None);
    let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
    assert!(ok, "mp3 failed: {err}\n{args:?}");
    assert!(ffprobe_ok(&tools, &out));

    // gif → gif re-quantize
    let ginfo = probe(&tools, &s.join("sample.gif")).await.unwrap();
    assert_eq!(ginfo.kind, MediaKind::Gif);
    let out = out_dir().join("g.gif");
    let gs = GifSettings { quality: Quality::Acceptable, fps: 8, resize: Resize { mode: ResizeMode::Width, value: 240 }, loop_forever: true };
    let args = gif::build_args(&ginfo, &gs, &out, None);
    let (ok, err) = run(tools.ffmpeg().unwrap(), &args);
    assert!(ok, "gif2 failed: {err}\n{args:?}");
    assert!(std::fs::metadata(&out).unwrap().len() < ginfo.size);
}

#[tokio::test]
async fn images_all_formats() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let info = probe(&tools, &s.join("sample.jpg")).await.unwrap();
    assert_eq!(info.kind, MediaKind::Image);
    assert_eq!(info.width, Some(1600));
    for (fmt, ext) in [(ImageFormat::Jpg, "jpg"), (ImageFormat::Png, "png"), (ImageFormat::Webp, "webp"), (ImageFormat::Avif, "avif")] {
        let is = ImageSettings { format: fmt, quality: Quality::Good, resize: Resize { mode: ResizeMode::LongEdge, value: 800 }, keep_metadata: false };
        let out = out_dir().join(format!("img.{ext}"));
        let dims = image_enc::compress(&tools, &info, &is, &out).unwrap();
        assert_eq!(dims, (800, 500));
        let sz = std::fs::metadata(&out).unwrap().len();
        assert!(sz > 100, "{ext} too small");
        if ext != "avif" {
            let d = image::image_dimensions(&out).unwrap();
            assert_eq!(d, (800, 500));
        }
    }
    // PNG same-format lossless path
    let pinfo = probe(&tools, &s.join("sample.png")).await.unwrap();
    let out = out_dir().join("same.png");
    image_enc::compress(&tools, &pinfo, &ImageSettings::default(), &out).unwrap();
    assert!(out.exists());
}

#[tokio::test]
async fn pdf_gs() {
    let Some(s) = samples() else { return };
    let tools = Tools::detect();
    let Ok(gs) = tools.gs() else { return };
    let input = s.join("sample.pdf");
    let out = out_dir().join("out.pdf");
    let args = pdf::build_args(&input, &out, Quality::Acceptable);
    let (ok, err) = run(gs, &args);
    assert!(ok, "gs failed: {err}\n{args:?}");
    assert!(out.exists());
}

// ───────── finalize() — the only code path that touches user files ─────────
mod finalize {
    use feather_lib::engine::output::{finalize, temp_path_for};
    use feather_lib::engine::settings::OutputSettings;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join("feather-finalize-tests").join(name);
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn write(p: &PathBuf, n: usize) { std::fs::write(p, vec![b'x'; n]).unwrap(); }

    #[test]
    fn default_keeps_original_and_writes_new_file() {
        let d = scratch("default");
        let input = d.join("a.mp4"); write(&input, 1000);
        let out = d.join("a_compressed.mp4");
        let tmp = temp_path_for(&out); write(&tmp, 400);
        let s = OutputSettings::default();
        let (p, size) = finalize(&input, &tmp, &out, "mp4", &s, 1000).unwrap();
        assert_eq!(p, out); assert_eq!(size, 400);
        assert!(input.exists(), "original must be untouched");
        assert_eq!(std::fs::metadata(&input).unwrap().len(), 1000);
        assert!(!tmp.exists());
    }

    #[test]
    fn overwrite_same_ext_replaces_in_place() {
        let d = scratch("overwrite");
        let input = d.join("a.jpg"); write(&input, 1000);
        let out = d.join("a.jpg"); // resolve_output returns the input path in overwrite mode
        let tmp = temp_path_for(&out); write(&tmp, 300);
        let s = OutputSettings { overwrite_original: true, ..Default::default() };
        let (p, size) = finalize(&input, &tmp, &out, "jpg", &s, 1000).unwrap();
        assert_eq!(p, input); assert_eq!(size, 300);
        assert_eq!(std::fs::metadata(&input).unwrap().len(), 300, "input must now hold compressed bytes");
        assert!(!tmp.exists());
    }

    #[test]
    fn overwrite_diff_ext_writes_new_and_removes_original() {
        let d = scratch("overwrite-ext");
        let input = d.join("a.png"); write(&input, 1000);
        let out = d.join("a.webp");
        let tmp = temp_path_for(&out); write(&tmp, 300);
        let s = OutputSettings { overwrite_original: true, ..Default::default() };
        let (p, _) = finalize(&input, &tmp, &out, "webp", &s, 1000).unwrap();
        assert_eq!(p, out);
        assert!(out.exists());
        assert!(!input.exists(), "original should be trashed");
    }

    #[test]
    fn skip_if_larger_keeps_original_bytes() {
        let d = scratch("larger");
        let input = d.join("a.mp4"); write(&input, 1000);
        let out = d.join("a_compressed.mp4");
        let tmp = temp_path_for(&out); write(&tmp, 1200); // worse than input
        let s = OutputSettings { skip_if_larger: true, ..Default::default() };
        let (p, size) = finalize(&input, &tmp, &out, "mp4", &s, 1000).unwrap();
        assert_eq!(p, out); assert_eq!(size, 1000, "output should be a copy of the original");
        assert!(input.exists());
        assert!(!tmp.exists());
        // and with overwrite: original untouched, nothing else written
        let d = scratch("larger-overwrite");
        let input = d.join("b.mp4"); write(&input, 1000);
        let tmp = temp_path_for(&input); write(&tmp, 1200);
        let s = OutputSettings { skip_if_larger: true, overwrite_original: true, ..Default::default() };
        let (p, size) = finalize(&input, &tmp, &input, "mp4", &s, 1000).unwrap();
        assert_eq!(p, input); assert_eq!(size, 1000);
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
    }

    #[test]
    fn trash_original_removes_input() {
        let d = scratch("trash");
        let input = d.join("a.mp4"); write(&input, 1000);
        let out = d.join("a_compressed.mp4");
        let tmp = temp_path_for(&out); write(&tmp, 400);
        let s = OutputSettings { trash_original: true, ..Default::default() };
        finalize(&input, &tmp, &out, "mp4", &s, 1000).unwrap();
        assert!(out.exists());
        assert!(!input.exists());
    }

    #[test]
    fn keep_dates_copies_mtime() {
        let d = scratch("dates");
        let input = d.join("a.mp4"); write(&input, 1000);
        let old = filetime::FileTime::from_unix_time(1_600_000_000, 0);
        filetime::set_file_mtime(&input, old).unwrap();
        let out = d.join("a_compressed.mp4");
        let tmp = temp_path_for(&out); write(&tmp, 400);
        let s = OutputSettings { keep_dates: true, ..Default::default() };
        finalize(&input, &tmp, &out, "mp4", &s, 1000).unwrap();
        let m = filetime::FileTime::from_last_modification_time(&std::fs::metadata(&out).unwrap());
        assert_eq!(m.unix_seconds(), 1_600_000_000);
    }
}

#[cfg(target_os = "macos")]
#[test]
fn quick_action_workflow_is_valid_plist() {
    let dir = feather_lib::install_quick_action_for_test().unwrap();
    for f in ["Info.plist", "document.wflow"] {
        let p = std::path::Path::new(&dir).join("Contents").join(f);
        let out = std::process::Command::new("plutil").arg("-lint").arg(&p).output().unwrap();
        assert!(out.status.success(), "{f}: {}", String::from_utf8_lossy(&out.stdout));
    }
}

/// Real network test of the FFmpeg self-installer (skipped unless FEATHER_NET=1).
#[tokio::test]
async fn ffmpeg_self_install_downloads_and_runs() {
    if std::env::var("FEATHER_NET").is_err() { return; }
    let dir = std::env::temp_dir().join("feather-install-test");
    let _ = std::fs::remove_dir_all(&dir);
    let report = |e: feather_lib::engine::install::InstallEvent| eprintln!("{:?} {:?} {}", e.phase, e.percent, e.message);
    let paths = feather_lib::engine::install::install_ffmpeg(&dir, &report).await.unwrap();
    assert!(paths.iter().any(|p| p.ends_with("ffmpeg")), "{paths:?}");
    assert!(paths.iter().any(|p| p.ends_with("ffprobe")), "{paths:?}");
    let t = feather_lib::engine::Tools::detect_with_dir(&dir);
    assert_eq!(t.ffmpeg.as_deref(), Some(dir.join("ffmpeg").as_path()));
    let out = std::process::Command::new(&dir.join("ffprobe")).arg("-version").output().unwrap();
    assert!(out.status.success());
}
