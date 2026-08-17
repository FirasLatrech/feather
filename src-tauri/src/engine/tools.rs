//! Locates external binaries. Paths are resolved once and injected everywhere;
//! nothing else in the crate hardcodes a binary path.
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct Tools {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub ghostscript: Option<PathBuf>,
}

fn find(names: &[&str]) -> Option<PathBuf> {
    for n in names {
        if let Ok(p) = which::which(n) {
            return Some(p);
        }
    }
    // Common locations not on PATH for GUI apps.
    let extra = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "C:\\ffmpeg\\bin",
        "C:\\Program Files\\gs\\bin",
    ];
    for dir in extra {
        for n in names {
            let p = PathBuf::from(dir).join(n);
            if p.exists() {
                return Some(p);
            }
            let exe = PathBuf::from(dir).join(format!("{n}.exe"));
            if exe.exists() {
                return Some(exe);
            }
        }
    }
    None
}

impl Tools {
    pub fn detect() -> Self {
        Self {
            ffmpeg: find(&["ffmpeg"]),
            ffprobe: find(&["ffprobe"]),
            ghostscript: find(&["gs", "gswin64c", "gswin32c"]),
        }
    }
    pub fn ffmpeg(&self) -> Result<&PathBuf, String> {
        self.ffmpeg.as_ref().ok_or_else(|| {
            "FFmpeg not found. Install it (brew install ffmpeg) or set the path in Settings.".into()
        })
    }
    pub fn ffprobe(&self) -> Result<&PathBuf, String> {
        self.ffprobe
            .as_ref()
            .ok_or_else(|| "ffprobe not found (comes with FFmpeg).".into())
    }
    pub fn gs(&self) -> Result<&PathBuf, String> {
        self.ghostscript.as_ref().ok_or_else(|| {
            "Ghostscript not found. Install it (brew install ghostscript) to compress PDFs.".into()
        })
    }
}
