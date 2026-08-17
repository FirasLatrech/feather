use super::probe::MediaInfo;
use super::settings::{OutputLocation, OutputSettings, Quality};
use std::path::{Path, PathBuf};

pub fn quality_label(q: Quality) -> &'static str {
    match q {
        Quality::Highest => "highest",
        Quality::High => "high",
        Quality::Good => "good",
        Quality::Medium => "medium",
        Quality::Acceptable => "acceptable",
    }
}

/// Resolve the final output path (directory + templated file name + extension).
/// Handles name collisions with an incrementing suffix.
pub fn resolve_output(
    info: &MediaInfo,
    out: &OutputSettings,
    quality: Quality,
    codec: &str,
    ext: &str,
    resolution: Option<(u32, u32)>,
) -> Result<PathBuf, String> {
    let input = Path::new(&info.path);
    let parent = input.parent().ok_or("input has no parent dir")?;
    let dir = match out.location {
        OutputLocation::SameFolder => parent.to_path_buf(),
        OutputLocation::Subfolder => {
            let name = if out.subfolder_name.trim().is_empty() { "compressed" } else { out.subfolder_name.trim() };
            parent.join(name)
        }
        OutputLocation::Custom => {
            if out.custom_dir.trim().is_empty() {
                parent.to_path_buf()
            } else {
                PathBuf::from(out.custom_dir.trim())
            }
        }
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create output dir: {e}"))?;

    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "output".into());
    let now = chrono::Local::now();
    let res_str = resolution
        .map(|(w, h)| format!("{w}x{h}"))
        .or_else(|| info.width.zip(info.height).map(|(w, h)| format!("{w}x{h}")))
        .unwrap_or_default();

    let mut tpl = if out.name_template.trim().is_empty() { "{name}".to_string() } else { out.name_template.clone() };
    if out.overwrite_original {
        tpl = "{name}".into();
    }
    let file = tpl
        .replace("{name}", &stem)
        .replace("{ext}", ext)
        .replace("{quality}", quality_label(quality))
        .replace("{resolution}", &res_str)
        .replace("{codec}", codec)
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H-%M-%S").to_string());
    let file = sanitize(&file);

    let mut candidate = dir.join(format!("{file}.{ext}"));
    if out.overwrite_original {
        // Overwrite mode: we write to a temp file first and swap later; return the *final* path.
        return Ok(candidate);
    }
    let mut i = 1;
    while candidate.exists() || candidate == input {
        candidate = dir.join(format!("{file} ({i}).{ext}"));
        i += 1;
    }
    Ok(candidate)
}

fn sanitize(s: &str) -> String {
    let bad = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let out: String = s.chars().map(|c| if bad.contains(&c) { '_' } else { c }).collect();
    let out = out.trim();
    if out.is_empty() { "output".into() } else { out.to_string() }
}

/// Temp path next to the final output (same filesystem → atomic rename).
pub fn temp_path_for(final_path: &Path) -> PathBuf {
    let dir = final_path.parent().unwrap_or(Path::new("."));
    let ext = final_path.extension().and_then(|e| e.to_str()).unwrap_or("tmp");
    dir.join(format!(".feather-{}.{}", uuid::Uuid::new_v4().simple(), ext))
}
