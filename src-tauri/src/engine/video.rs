use super::probe::MediaInfo;
use super::settings::{Quality, VideoCodec, VideoFormat, VideoSettings};
use std::path::Path;

pub struct Plan {
    /// Extension of the output file
    pub ext: &'static str,
    /// Two-pass? (target size mode)
    pub two_pass: bool,
    /// Human-readable codec name for templates
    pub codec_label: &'static str,
    /// Target resolution if resizing
    pub resolution: Option<(u32, u32)>,
}

pub fn output_ext(info: &MediaInfo, s: &VideoSettings) -> &'static str {
    match s.format {
        VideoFormat::Mp4 => "mp4",
        VideoFormat::Webm => "webm",
        VideoFormat::Mov => "mov",
        VideoFormat::Mkv => "mkv",
        VideoFormat::Gif => "gif",
        VideoFormat::Mp3 => "mp3",
        VideoFormat::Same => {
            let ext = Path::new(&info.path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            match ext.as_str() {
                "mov" => "mov",
                "webm" => "webm",
                "mkv" => "mkv",
                _ => "mp4",
            }
        }
    }
}

fn effective_codec(info: &MediaInfo, ext: &str, s: &VideoSettings) -> VideoCodec {
    let requested = match s.codec {
        VideoCodec::Auto => match info.video_codec.as_deref() {
            Some("hevc") | Some("h265") => VideoCodec::H265,
            Some("vp9") if ext == "webm" => VideoCodec::Vp9,
            Some("av1") => VideoCodec::Av1,
            _ => VideoCodec::H264,
        },
        c => c,
    };
    let s = &VideoSettings { codec: requested, ..s.clone() };
    match ext {
        // WebM only supports VP8/VP9/AV1
        "webm" => match s.codec {
            VideoCodec::Av1 => VideoCodec::Av1,
            _ => VideoCodec::Vp9,
        },
        // MOV/MP4 don't play VP9 in QuickTime; fall back to H.264/H.265 for those containers.
        "mov" | "mp4" => match s.codec {
            VideoCodec::Vp9 => VideoCodec::H264,
            c => c,
        },
        _ => s.codec,
    }
}

fn crf(codec: VideoCodec, q: Quality) -> u32 {
    let base = match q {
        Quality::Highest => 0,
        Quality::High => 1,
        Quality::Good => 2,
        Quality::Medium => 3,
        Quality::Acceptable => 4,
    };
    match codec {
        VideoCodec::Auto | VideoCodec::H264 => [18, 22, 26, 30, 34][base],
        VideoCodec::H265 => [20, 24, 28, 32, 36][base],
        VideoCodec::Vp9 => [24, 30, 34, 38, 42][base],
        VideoCodec::Av1 => [26, 32, 38, 44, 50][base],
    }
}

/// VideoToolbox uses -q:v 1..100 (higher = better), not CRF. Ladders calibrated so that
/// "Good" lands near the size of libx264 crf 26 / libx265 crf 28 on 1080p content.
fn vt_quality(codec: VideoCodec, q: Quality) -> u32 {
    let i = match q { Quality::Highest => 0, Quality::High => 1, Quality::Good => 2, Quality::Medium => 3, Quality::Acceptable => 4 };
    match codec {
        VideoCodec::H265 => [66, 59, 53, 47, 41][i],
        _ => [65, 57, 50, 44, 38][i],
    }
}

pub fn plan(info: &MediaInfo, s: &VideoSettings) -> Plan {
    let ext = output_ext(info, s);
    let codec = effective_codec(info, ext, s);
    let resolution = info.width.zip(info.height).and_then(|(w, h)| s.resize.target(w, h));
    Plan {
        ext,
        two_pass: s.target_size_mb.is_some() && ext != "gif" && ext != "mp3",
        codec_label: match codec {
            VideoCodec::Auto | VideoCodec::H264 => "h264",
            VideoCodec::H265 => "h265",
            VideoCodec::Vp9 => "vp9",
            VideoCodec::Av1 => "av1",
        },
        resolution,
    }
}

fn even(v: u32) -> u32 {
    if v % 2 == 1 { v + 1 } else { v }
}

/// Build the ffmpeg argument list. `pass` = 0 for single-pass, 1/2 for two-pass.
/// `passlog` is required for two-pass runs.
pub fn build_args(
    info: &MediaInfo,
    s: &VideoSettings,
    out: &Path,
    pass: u8,
    passlog: Option<&Path>,
) -> Vec<String> {
    let ext = output_ext(info, s);
    let codec = effective_codec(info, ext, s);
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];
    // Hardware encoding is always used where available (not user-configurable).
    // Target-size mode needs accurate two-pass rate control → software encoder in that case.
    let use_hw = cfg!(target_os = "macos") && s.target_size_mb.is_none()
        && matches!(codec, VideoCodec::H264 | VideoCodec::H265);
    if use_hw && ext != "mp3" {
        // Hardware-accelerated *decode* as well (big win for 4K sources).
        a.extend(["-hwaccel".into(), "videotoolbox".into()]);
    }

    // Trim (input-side seek is fast & accurate enough with re-encode)
    if let Some(st) = s.trim_start.filter(|v| *v > 0.0) {
        a.extend(["-ss".into(), format!("{st:.3}")]);
    }
    a.extend(["-i".into(), info.path.clone()]);
    if let (Some(st), Some(en)) = (s.trim_start.or(Some(0.0)), s.trim_end) {
        if en > st {
            a.extend(["-t".into(), format!("{:.3}", en - st)]);
        }
    }

    // MP3 extraction: audio only
    if ext == "mp3" {
        a.extend(["-vn".into(), "-c:a".into(), "libmp3lame".into(), "-q:a".into(), "2".into()]);
        a.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);
        a.push(out.to_string_lossy().to_string());
        return a;
    }

    // Video filters
    let mut vf: Vec<String> = Vec::new();
    if let Some((w, h)) = info.width.zip(info.height).and_then(|(w, h)| s.resize.target(w, h)) {
        vf.push(format!("scale={}:{}:flags=lanczos", even(w), even(h)));
    } else {
        // Ensure even dimensions (H.264/H.265 4:2:0 requirement)
        vf.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
    }
    if let Some(fps) = s.fps.filter(|f| *f > 0) {
        if info.fps.map(|src| (fps as f64) < src).unwrap_or(true) {
            vf.push(format!("fps={fps}"));
        }
    }
    if !vf.is_empty() {
        a.extend(["-vf".into(), vf.join(",")]);
    }

    // Encoder + quality
    let two_pass = s.target_size_mb.is_some();
    let mut target_bitrate_k: Option<u64> = None;
    if let Some(mb) = s.target_size_mb {
        if let Some(d) = info.duration.filter(|d| *d > 0.0) {
            let dur = match (s.trim_start, s.trim_end) {
                (st, Some(en)) => (en - st.unwrap_or(0.0)).max(0.1),
                (Some(st), None) => (d - st).max(0.1),
                _ => d,
            };
            let total_kbps = (mb * 8.0 * 1024.0 * 1024.0 / 1000.0) / dur; // kbit/s
            let audio_kbps = if s.remove_audio || !info.has_audio { 0.0 } else { 128.0 };
            let v = (total_kbps * 0.97 - audio_kbps).max(50.0);
            target_bitrate_k = Some(v as u64);
        }
    }

    match codec {
        VideoCodec::Auto | VideoCodec::H264 | VideoCodec::H265 => {
            if use_hw {
                let enc = if codec == VideoCodec::H264 { "h264_videotoolbox" } else { "hevc_videotoolbox" };
                a.extend(["-c:v".into(), enc.into(), "-realtime".into(), "0".into(), "-prio_speed".into(), "1".into()]);
                if let Some(bk) = target_bitrate_k {
                    a.extend(["-b:v".into(), format!("{bk}k")]);
                } else {
                    a.extend(["-q:v".into(), vt_quality(codec, s.quality).to_string()]);
                }
                if codec == VideoCodec::H265 {
                    a.extend(["-tag:v".into(), "hvc1".into()]);
                }
                a.extend(["-pix_fmt".into(), "yuv420p".into()]);
            } else {
                let enc = if codec == VideoCodec::H264 { "libx264" } else { "libx265" };
                // `fast` is ~2x quicker than `medium` for ~3-5% larger files — the right default for a
                // desktop tool; Highest quality keeps `medium`.
                let preset = if s.quality == Quality::Highest { "medium" } else { "fast" };
                a.extend(["-c:v".into(), enc.into(), "-preset".into(), preset.into()]);
                if let Some(bk) = target_bitrate_k {
                    a.extend(["-b:v".into(), format!("{bk}k")]);
                    if codec == VideoCodec::H265 {
                        let log = passlog.map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                        a.extend(["-x265-params".into(), format!("pass={pass}:stats={log}:log-level=error")]);
                    }
                } else {
                    a.extend(["-crf".into(), crf(codec, s.quality).to_string()]);
                    if codec == VideoCodec::H265 {
                        a.extend(["-x265-params".into(), "log-level=error".into()]);
                    }
                }
                if codec == VideoCodec::H265 {
                    a.extend(["-tag:v".into(), "hvc1".into()]);
                }
                a.extend(["-pix_fmt".into(), "yuv420p".into()]);
                if s.threads > 0 {
                    a.extend(["-threads".into(), s.threads.to_string()]);
                }
            }
        }
        VideoCodec::Vp9 => {
            a.extend(["-c:v".into(), "libvpx-vp9".into(), "-row-mt".into(), "1".into(), "-deadline".into(), "good".into(), "-cpu-used".into(), "4".into(), "-tile-columns".into(), "2".into()]);
            if let Some(bk) = target_bitrate_k {
                a.extend(["-b:v".into(), format!("{bk}k")]);
            } else {
                a.extend(["-crf".into(), crf(codec, s.quality).to_string(), "-b:v".into(), "0".into()]);
            }
            a.extend(["-pix_fmt".into(), "yuv420p".into()]);
        }
        VideoCodec::Av1 => {
            a.extend(["-c:v".into(), "libsvtav1".into(), "-preset".into(), "10".into()]);
            if let Some(bk) = target_bitrate_k {
                a.extend(["-b:v".into(), format!("{bk}k")]);
            } else {
                a.extend(["-crf".into(), crf(codec, s.quality).to_string()]);
            }
            a.extend(["-pix_fmt".into(), "yuv420p10le".into()]);
        }
    }

    // Two-pass flags (x264 / vp9 / av1 use -pass; x265 handled via params above)
    if two_pass && pass > 0 && !(codec == VideoCodec::H265 && !use_hw) {
        a.extend(["-pass".into(), pass.to_string()]);
        if let Some(p) = passlog {
            a.extend(["-passlogfile".into(), p.to_string_lossy().to_string()]);
        }
    }

    // Audio
    if s.remove_audio || !info.has_audio || pass == 1 {
        a.push("-an".into());
    } else {
        let ac = info.audio_codec.as_deref().unwrap_or("");
        match ext {
            "webm" => {
                if matches!(ac, "opus" | "vorbis") {
                    a.extend(["-c:a".into(), "copy".into()]);
                } else {
                    a.extend(["-c:a".into(), "libopus".into(), "-b:a".into(), "112k".into()]);
                }
            }
            "mkv" => {
                a.extend(["-c:a".into(), "copy".into()]);
            }
            _ => {
                if matches!(ac, "aac" | "mp3" | "ac3" | "alac") && target_bitrate_k.is_none() {
                    a.extend(["-c:a".into(), "copy".into()]);
                } else {
                    a.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "128k".into()]);
                }
            }
        }
    }

    // Container flags
    if matches!(ext, "mp4" | "mov") {
        a.extend(["-movflags".into(), "+faststart".into()]);
    }
    a.extend(["-map_metadata".into(), "0".into()]);
    a.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);

    if pass == 1 {
        // First pass: discard output
        a.extend(["-f".into(), "null".into()]);
        a.push(if cfg!(windows) { "NUL".into() } else { "/dev/null".into() });
    } else {
        a.push(out.to_string_lossy().to_string());
    }
    a
}
