use super::tools::Tools;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Image,
    Gif,
    Pdf,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub kind: MediaKind,
    pub size: u64,
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub has_audio: bool,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate: Option<u64>,
}

pub fn kind_from_ext(path: &Path) -> MediaKind {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp4" | "mov" | "m4v" | "mkv" | "webm" | "avi" | "flv" | "ts" | "mts" | "m2ts" | "wmv"
        | "3gp" | "mpg" | "mpeg" | "ogv" => MediaKind::Video,
        "jpg" | "jpeg" | "png" | "webp" | "avif" | "heic" | "heif" | "tif" | "tiff" | "bmp" => {
            MediaKind::Image
        }
        "gif" => MediaKind::Gif,
        "pdf" => MediaKind::Pdf,
        _ => MediaKind::Unknown,
    }
}

fn parse_rate(s: &str) -> Option<f64> {
    let mut it = s.split('/');
    let a: f64 = it.next()?.parse().ok()?;
    let b: f64 = it.next().map(|b| b.parse().unwrap_or(1.0)).unwrap_or(1.0);
    if b == 0.0 {
        None
    } else {
        Some(a / b)
    }
}

pub async fn probe(tools: &Tools, path: &Path) -> Result<MediaInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let kind = kind_from_ext(path);
    let mut info = MediaInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        kind,
        size: meta.len(),
        duration: None,
        width: None,
        height: None,
        fps: None,
        has_audio: false,
        video_codec: None,
        audio_codec: None,
        bitrate: None,
    };

    if kind == MediaKind::Pdf || kind == MediaKind::Unknown {
        return Ok(info);
    }

    if kind == MediaKind::Image {
        if let Ok(dim) = image::image_dimensions(path) {
            info.width = Some(dim.0);
            info.height = Some(dim.1);
            return Ok(info);
        }
    }

    let ffprobe = tools.ffprobe()?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    if let Some(fmt) = v.get("format") {
        info.duration = fmt.get("duration").and_then(|d| d.as_str()).and_then(|d| d.parse().ok());
        info.bitrate = fmt.get("bit_rate").and_then(|d| d.as_str()).and_then(|d| d.parse().ok());
    }
    if let Some(streams) = v.get("streams").and_then(|s| s.as_array()) {
        for s in streams {
            match s.get("codec_type").and_then(|c| c.as_str()) {
                Some("video") if info.width.is_none() => {
                    info.width = s.get("width").and_then(|w| w.as_u64()).map(|w| w as u32);
                    info.height = s.get("height").and_then(|w| w.as_u64()).map(|w| w as u32);
                    info.video_codec = s.get("codec_name").and_then(|c| c.as_str()).map(String::from);
                    info.fps = s
                        .get("avg_frame_rate")
                        .and_then(|r| r.as_str())
                        .and_then(parse_rate)
                        .filter(|f| *f > 0.0)
                        .or_else(|| s.get("r_frame_rate").and_then(|r| r.as_str()).and_then(parse_rate));
                    if info.duration.is_none() {
                        info.duration = s.get("duration").and_then(|d| d.as_str()).and_then(|d| d.parse().ok());
                    }
                }
                Some("audio") => {
                    info.has_audio = true;
                    if info.audio_codec.is_none() {
                        info.audio_codec = s.get("codec_name").and_then(|c| c.as_str()).map(String::from);
                    }
                }
                _ => {}
            }
        }
    }
    Ok(info)
}
