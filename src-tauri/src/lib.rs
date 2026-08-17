pub mod engine;

use engine::jobs::{HistoryItem, Job};
use engine::probe::{kind_from_ext, MediaInfo, MediaKind};
use engine::settings::Settings;
use engine::{JobManager, Tools};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

struct AppState {
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    cache_dir: PathBuf,
}

fn load_settings(path: &Path) -> Settings {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn tools_with_overrides(s: &Settings) -> Tools {
    let mut t = Tools::detect();
    if let Some(p) = s.ffmpeg_path.as_ref().filter(|p| !p.trim().is_empty()) {
        let p = PathBuf::from(p.trim());
        if p.exists() {
            let probe = p.parent().map(|d| d.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));
            t.ffmpeg = Some(p);
            if let Some(pr) = probe.filter(|x| x.exists()) {
                t.ffprobe = Some(pr);
            }
        }
    }
    if let Some(p) = s.gs_path.as_ref().filter(|p| !p.trim().is_empty()) {
        let p = PathBuf::from(p.trim());
        if p.exists() {
            t.ghostscript = Some(p);
        }
    }
    t
}

#[tauri::command]
async fn get_tools(mgr: State<'_, JobManager>) -> Result<Tools, String> {
    Ok(mgr.tools().await)
}

fn collect_files(p: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 12 {
        return;
    }
    if p.is_dir() {
        if let Ok(rd) = std::fs::read_dir(p) {
            let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
            entries.sort();
            for e in entries {
                let name = e.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with('.') {
                    continue;
                }
                collect_files(&e, out, depth + 1);
            }
        }
    } else if kind_from_ext(p) != MediaKind::Unknown {
        out.push(p.to_path_buf());
    }
}

#[tauri::command]
async fn probe_paths(paths: Vec<String>, mgr: State<'_, JobManager>) -> Result<Vec<MediaInfo>, String> {
    let tools = mgr.tools().await;
    let mut files = Vec::new();
    for p in paths {
        collect_files(Path::new(&p), &mut files, 0);
    }
    files.dedup();
    let mut out = Vec::with_capacity(files.len());
    // Probe with limited parallelism.
    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(6));
    let mut handles = Vec::new();
    for f in files {
        let t = tools.clone();
        let sem = sem.clone();
        handles.push(tokio::spawn(async move {
            let _p = sem.acquire().await.ok();
            engine::probe::probe(&t, &f).await
        }));
    }
    for h in handles {
        match h.await {
            Ok(Ok(info)) => out.push(info),
            Ok(Err(e)) => eprintln!("probe error: {e}"),
            Err(e) => eprintln!("probe join error: {e}"),
        }
    }
    Ok(out)
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command]
async fn save_settings(settings: Settings, state: State<'_, AppState>, mgr: State<'_, JobManager>) -> Result<(), String> {
    if let Some(p) = state.settings_path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&state.settings_path, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    mgr.set_concurrency(settings.concurrency).await;
    mgr.set_tools(tools_with_overrides(&settings)).await;
    *state.settings.lock().await = settings;
    Ok(())
}

#[tauri::command]
async fn start_compression(
    files: Vec<MediaInfo>,
    overrides: Option<HashMap<String, Settings>>,
    state: State<'_, AppState>,
    mgr: State<'_, JobManager>,
) -> Result<Vec<Job>, String> {
    let base = state.settings.lock().await.clone();
    let overrides = overrides.unwrap_or_default();
    let inputs = files
        .into_iter()
        .map(|f| {
            let s = overrides.get(&f.path).cloned().unwrap_or_else(|| base.clone());
            (f, s)
        })
        .collect();
    Ok(mgr.enqueue(inputs).await)
}

#[tauri::command]
async fn list_jobs(mgr: State<'_, JobManager>) -> Result<Vec<Job>, String> {
    Ok(mgr.list().await)
}
#[tauri::command]
async fn cancel_job(id: Uuid, mgr: State<'_, JobManager>) -> Result<(), String> {
    mgr.cancel(id).await;
    Ok(())
}
#[tauri::command]
async fn cancel_all(mgr: State<'_, JobManager>) -> Result<(), String> {
    mgr.cancel_all().await;
    Ok(())
}
#[tauri::command]
async fn remove_job(id: Uuid, mgr: State<'_, JobManager>) -> Result<(), String> {
    mgr.remove(id).await;
    Ok(())
}
#[tauri::command]
async fn clear_finished(mgr: State<'_, JobManager>) -> Result<(), String> {
    mgr.clear_finished().await;
    Ok(())
}
#[tauri::command]
async fn get_history(mgr: State<'_, JobManager>) -> Result<Vec<HistoryItem>, String> {
    Ok(mgr.read_history())
}
#[tauri::command]
async fn clear_history(mgr: State<'_, JobManager>) -> Result<(), String> {
    mgr.clear_history();
    Ok(())
}

/// Generate (and cache) a small JPEG thumbnail for a video/PDF/image; returns its path.
#[tauri::command]
async fn thumbnail(path: String, state: State<'_, AppState>, mgr: State<'_, JobManager>) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let mtime = meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = format!("{:x}", md5ish(&format!("{path}|{mtime}|{}", meta.len())));
    let out = state.cache_dir.join("thumbs").join(format!("{key}.jpg"));
    if out.exists() {
        return Ok(Some(out.to_string_lossy().to_string()));
    }
    std::fs::create_dir_all(out.parent().unwrap()).map_err(|e| e.to_string())?;
    let tools = mgr.tools().await;
    let kind = kind_from_ext(&p);
    let ok = match kind {
        MediaKind::Video | MediaKind::Gif | MediaKind::Image => {
            let ff = tools.ffmpeg()?;
            let mut cmd = tokio::process::Command::new(ff);
            cmd.args(["-hide_banner", "-y", "-nostdin", "-loglevel", "error"]);
            if kind == MediaKind::Video {
                cmd.args(["-ss", "0.5"]);
            }
            cmd.arg("-i").arg(&p).args(["-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4"]).arg(&out);
            cmd.output().await.map(|o| o.status.success()).unwrap_or(false)
        }
        MediaKind::Pdf => {
            let gs = tools.gs()?;
            tokio::process::Command::new(gs)
                .args(["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=jpeg", "-dFirstPage=1", "-dLastPage=1", "-r40", "-dJPEGQ=80"])
                .arg(format!("-sOutputFile={}", out.to_string_lossy()))
                .arg(&p)
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        MediaKind::Unknown => false,
    };
    if ok && out.exists() {
        Ok(Some(out.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

// Tiny FNV-1a; good enough for cache keys.
fn md5ish(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[tauri::command]
fn app_dirs(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let mut m = HashMap::new();
    if let Ok(p) = app.path().app_config_dir() {
        m.insert("config".into(), p.to_string_lossy().to_string());
    }
    if let Ok(p) = app.path().download_dir() {
        m.insert("downloads".into(), p.to_string_lossy().to_string());
    }
    if let Ok(p) = app.path().desktop_dir() {
        m.insert("desktop".into(), p.to_string_lossy().to_string());
    }
    Ok(m)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir().expect("config dir");
            let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| config_dir.join("cache"));
            let settings_path = config_dir.join("settings.json");
            let settings = load_settings(&settings_path);
            let tools = tools_with_overrides(&settings);
            let mgr = JobManager::new(app.handle().clone(), tools, settings.concurrency, config_dir.join("history.json"));
            app.manage(mgr);
            app.manage(AppState { settings: Mutex::new(settings), settings_path, cache_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tools,
            probe_paths,
            get_settings,
            save_settings,
            start_compression,
            list_jobs,
            cancel_job,
            cancel_all,
            remove_job,
            clear_finished,
            get_history,
            clear_history,
            thumbnail,
            app_dirs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
