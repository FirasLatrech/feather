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

/// Move the finished temp file into place according to output settings.
/// Returns (final path, final size). Pure filesystem logic — no app state — so it is unit-testable.
pub fn finalize(
    input_path: &Path,
    tmp: &Path,
    final_path: &Path,
    ext: &str,
    out: &OutputSettings,
    input_size: u64,
) -> Result<(PathBuf, u64), String> {
    let out_meta = std::fs::metadata(tmp).map_err(|e| format!("output missing: {e}"))?;
    let out_size = out_meta.len();
    // Capture source dates *before* anything is moved or trashed.
    let src_meta = std::fs::metadata(input_path).ok();
    let same_ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false);

    let final_real: PathBuf;
    if out.skip_if_larger && out_size >= input_size {
        // Result isn't smaller: keep original bytes.
        let _ = std::fs::remove_file(tmp);
        if out.overwrite_original {
            // Nothing to do — original stays untouched.
            final_real = input_path.to_path_buf();
        } else {
            std::fs::copy(input_path, final_path).map_err(|e| e.to_string())?;
            final_real = final_path.to_path_buf();
            if out.trash_original {
                let _ = trash::delete(input_path);
            }
        }
    } else if out.overwrite_original {
        if same_ext {
            // Atomic replace of the original (same filesystem).
            std::fs::rename(tmp, input_path).map_err(|e| format!("replace failed: {e}"))?;
            final_real = input_path.to_path_buf();
        } else {
            // Different extension: place next to original, then trash original.
            std::fs::rename(tmp, final_path).map_err(|e| format!("move failed: {e}"))?;
            let _ = trash::delete(input_path);
            final_real = final_path.to_path_buf();
        }
    } else {
        std::fs::rename(tmp, final_path).map_err(|e| format!("move failed: {e}"))?;
        final_real = final_path.to_path_buf();
        if out.trash_original {
            let _ = trash::delete(input_path);
        }
    }

    if out.keep_dates {
        if let Some(meta) = src_meta {
            let mtime = filetime::FileTime::from_last_modification_time(&meta);
            let atime = filetime::FileTime::from_last_access_time(&meta);
            let _ = filetime::set_file_times(&final_real, atime, mtime);
        }
    }
    let size = std::fs::metadata(&final_real).map(|m| m.len()).unwrap_or(out_size);
    Ok((final_real, size))
}

/// Remove stale `.feather-*` temp files in `dir` older than `max_age` (crash leftovers).
/// Age-gated so we never delete a temp file another running job is still writing.
pub fn sweep_temps(dir: &Path, max_age: std::time::Duration) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let now = std::time::SystemTime::now();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with(".feather-") { continue; }
        let old = e.metadata().and_then(|m| m.modified()).ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if old { let _ = std::fs::remove_file(e.path()); }
    }
}
