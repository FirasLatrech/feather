//! Cheap, pre-encode estimates of output size and duration. Heuristic — good enough to decide
//! whether a compression is worth running, shown on cards before the user presses Compress.
use super::probe::{MediaInfo, MediaKind};
use super::settings::{Quality, Settings};
use super::video;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Estimate {
    pub path: String,
    pub size: Option<u64>,
    /// seconds
    pub time: Option<f64>,
    /// true if the source is already so small we don't expect a meaningful reduction (<10%)
    pub already_small: bool,
}

/// Target video bitrate (bit/s) for a quality level at 1080p30, H.264. Scaled elsewhere.
fn base_bitrate(q: Quality) -> f64 {
    match q {
        Quality::Highest => 8_000_000.0,
        Quality::High => 5_000_000.0,
        Quality::Good => 3_200_000.0,
        Quality::Medium => 2_200_000.0,
        Quality::Acceptable => 1_500_000.0,
    }
}

/// Bitrate we'd aim for given source dims / fps / codec. Used both for estimates and for the
/// bitrate cap in `video::build_args`.
pub fn target_video_bitrate(info: &MediaInfo, s: &Settings) -> Option<f64> {
    let (w, h) = info.width.zip(info.height)?;
    let (w, h) = s.video.resize.target(w, h).unwrap_or((w, h));
    let fps = s.video.fps.map(|f| f as f64).or(info.fps).unwrap_or(30.0).min(120.0);
    let px = (w as f64 * h as f64) / (1920.0 * 1080.0);
    let codec_factor = match video::plan(info, &s.video).codec_label {
        "h265" => 0.65,
        "vp9" | "av1" => 0.6,
        _ => 1.0,
    };
    let fps_factor = (fps / 30.0).powf(0.7).max(0.5);
    Some(base_bitrate(s.video.quality) * px.powf(0.85) * fps_factor * codec_factor)
}

pub fn estimate(info: &MediaInfo, s: &Settings) -> Estimate {
    let mut est = Estimate { path: info.path.clone(), size: None, time: None, already_small: false };
    match info.kind {
        MediaKind::Video => {
            let Some(dur) = info.duration.filter(|d| *d > 0.0) else { return est };
            let plan = video::plan(info, &s.video);
            if plan.ext == "gif" || plan.ext == "mp3" {
                return est;
            }
            let audio_bps = if s.video.remove_audio || !info.has_audio { 0.0 } else { 128_000.0 };
            let src_bps = info.bitrate.map(|b| b as f64).unwrap_or(info.size as f64 * 8.0 / dur);
            let src_video_bps = (src_bps - if info.has_audio { 128_000.0 } else { 0.0 }).max(50_000.0);
            let target = if let Some(mb) = s.video.target_size_mb {
                mb * 1024.0 * 1024.0 * 8.0 / dur
            } else {
                let t = target_video_bitrate(info, s).unwrap_or(src_video_bps);
                // We never spend more bits than ~75% of the source (see build_args cap).
                t.min(src_video_bps * 0.75)
            };
            let size = ((target + audio_bps) * dur / 8.0) as u64;
            est.size = Some(size);
            est.already_small = (size as f64) > (info.size as f64) * 0.9;
            // Speed model (Apple Silicon HW ≈ 20× realtime at 1080p; software ≈ 4×; two-pass doubles).
            let px = info.width.zip(info.height).map(|(w, h)| (w as f64 * h as f64) / (1920.0 * 1080.0)).unwrap_or(1.0);
            let hw = cfg!(target_os = "macos") && s.video.target_size_mb.is_none() && matches!(plan.codec_label, "h264" | "h265");
            let base_speed = if hw { 20.0 } else { match plan.codec_label { "av1" => 6.0, "vp9" => 2.5, _ => 4.0 } };
            let speed = (base_speed / px.max(0.25)).max(0.3);
            let passes = if plan.two_pass { 2.0 } else { 1.0 };
            est.time = Some(dur * passes / speed);
        }
        MediaKind::Image => {
            let (w, h) = match info.width.zip(info.height) { Some(d) => d, None => return est };
            let (w, h) = s.image.resize.target(w, h).unwrap_or((w, h));
            let px = w as f64 * h as f64;
            let ext = super::image_enc::output_ext(info, &s.image);
            let bpp = match (ext, s.image.quality) {
                ("png", _) => 3.0,
                ("avif", q) | ("webp", q) => (match q { Quality::Highest => 1.2, Quality::High => 0.9, Quality::Good => 0.65, Quality::Medium => 0.5, Quality::Acceptable => 0.35 }) * (if ext == "avif" { 0.75 } else { 1.0 }),
                (_, q) => match q { Quality::Highest => 2.4, Quality::High => 1.7, Quality::Good => 1.2, Quality::Medium => 0.9, Quality::Acceptable => 0.65 },
            };
            let size = (px * bpp / 8.0) as u64;
            est.size = Some(size.min(info.size));
            est.already_small = (size as f64) > (info.size as f64) * 0.9;
            est.time = Some((px / 12_000_000.0).max(0.2) * if ext == "avif" { 4.0 } else { 1.0 });
        }
        MediaKind::Gif => {
            est.size = Some((info.size as f64 * 0.55) as u64);
            est.time = info.duration.map(|d| d * 0.5 + 1.0);
        }
        MediaKind::Pdf => {
            let f = match s.pdf.quality { Quality::Highest => 0.85, Quality::High => 0.6, Quality::Good => 0.4, Quality::Medium => 0.3, Quality::Acceptable => 0.2 };
            est.size = Some((info.size as f64 * f) as u64);
            est.time = Some((info.size as f64 / 3_000_000.0).max(0.5));
        }
        MediaKind::Unknown => {}
    }
    est
}
