use super::probe::MediaInfo;
use super::settings::{GifSettings, Quality};
use std::path::Path;

fn colors(q: Quality) -> u32 {
    match q {
        Quality::Highest => 256,
        Quality::High => 200,
        Quality::Good => 160,
        Quality::Medium => 128,
        Quality::Acceptable => 96,
    }
}

fn dither(q: Quality) -> &'static str {
    match q {
        Quality::Highest | Quality::High => "sierra2_4a",
        Quality::Good => "bayer:bayer_scale=3",
        Quality::Medium => "bayer:bayer_scale=4",
        Quality::Acceptable => "bayer:bayer_scale=5",
    }
}

pub fn resolution(info: &MediaInfo, s: &GifSettings) -> Option<(u32, u32)> {
    info.width.zip(info.height).and_then(|(w, h)| s.resize.target(w, h))
}

/// Video→GIF or GIF→GIF (re-quantize) with an optimal per-file palette in a single ffmpeg run.
pub fn build_args(info: &MediaInfo, s: &GifSettings, out: &Path, trim: Option<(f64, Option<f64>)>) -> Vec<String> {
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];
    if let Some((st, _)) = trim {
        if st > 0.0 {
            a.extend(["-ss".into(), format!("{st:.3}")]);
        }
    }
    a.extend(["-i".into(), info.path.clone()]);
    if let Some((st, Some(en))) = trim {
        if en > st {
            a.extend(["-t".into(), format!("{:.3}", en - st)]);
        }
    }
    let mut chain: Vec<String> = Vec::new();
    let fps = if s.fps == 0 { 15 } else { s.fps };
    let src_fps = info.fps.unwrap_or(30.0);
    if (fps as f64) < src_fps {
        chain.push(format!("fps={fps}"));
    }
    if let Some((w, _)) = resolution(info, s) {
        chain.push(format!("scale={w}:-1:flags=lanczos"));
    }
    let pre = if chain.is_empty() { String::new() } else { format!("{},", chain.join(",")) };
    let filter = format!(
        "{pre}split[s0][s1];[s0]palettegen=max_colors={}:stats_mode=diff[p];[s1][p]paletteuse=dither={}:diff_mode=rectangle",
        colors(s.quality),
        dither(s.quality)
    );
    a.extend(["-filter_complex".into(), filter]);
    a.extend(["-loop".into(), if s.loop_forever { "0".into() } else { "-1".into() }]);
    a.extend(["-an".into(), "-progress".into(), "pipe:1".into(), "-nostats".into()]);
    a.push(out.to_string_lossy().to_string());
    a
}
