//! Self-service tool installation: download static FFmpeg/ffprobe into the app's own bin dir,
//! and install Ghostscript through the platform package manager when available.
use futures_util::StreamExt;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase { Downloading, Extracting, Installing, Done, Error }

#[derive(Debug, Clone, Serialize)]
pub struct InstallEvent {
    pub tool: String,
    pub phase: Phase,
    /// 0..100 when known
    pub percent: Option<f32>,
    pub message: String,
}

pub type Report = dyn Fn(InstallEvent) + Send + Sync;

fn ev(tool: &str, phase: Phase, percent: Option<f32>, msg: impl Into<String>) -> InstallEvent {
    InstallEvent { tool: tool.into(), phase, percent, message: msg.into() }
}

/// Where Feather keeps tools it downloaded itself. Checked first by `Tools::detect_with_dir`.
pub fn tools_dir(app_data: &Path) -> PathBuf { app_data.join("bin") }

fn ffmpeg_urls() -> Result<Vec<(&'static str, String)>, String> {
    // (binary name, download url)
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    Ok(match (os, arch) {
        ("macos", "aarch64") => vec![
            ("ffmpeg", "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip".into()),
            ("ffprobe", "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip".into()),
        ],
        ("macos", _) => vec![
            ("ffmpeg", "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip".into()),
            ("ffprobe", "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffprobe.zip".into()),
        ],
        ("linux", "x86_64") => vec![
            ("ffmpeg", "https://ffmpeg.martin-riedl.de/redirect/latest/linux/amd64/release/ffmpeg.zip".into()),
            ("ffprobe", "https://ffmpeg.martin-riedl.de/redirect/latest/linux/amd64/release/ffprobe.zip".into()),
        ],
        ("linux", "aarch64") => vec![
            ("ffmpeg", "https://ffmpeg.martin-riedl.de/redirect/latest/linux/arm64/release/ffmpeg.zip".into()),
            ("ffprobe", "https://ffmpeg.martin-riedl.de/redirect/latest/linux/arm64/release/ffprobe.zip".into()),
        ],
        ("windows", _) => vec![
            ("bundle", "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip".into()),
        ],
        _ => return Err(format!("no FFmpeg download available for {os}/{arch}")),
    })
}

/// The redirect endpoint is occasionally flaky; fall back to scraping the newest build from the index.
async fn resolve_riedl(client: &reqwest::Client, url: &str) -> Result<String, String> {
    if let Ok(r) = client.head(url).send().await {
        if r.status().is_success() { return Ok(r.url().to_string()); }
    }
    // url = .../redirect/latest/<os>/<arch>/release/<file>.zip
    let parts: Vec<&str> = url.split('/').collect();
    let n = parts.len();
    let (os, arch, file) = (parts[n - 4], parts[n - 3], parts[n - 1]);
    let html = client.get("https://ffmpeg.martin-riedl.de/").send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let needle = format!("/download/{os}/{arch}/");
    let mut best: Option<(u64, String)> = None;
    for seg in html.split("href=\"").skip(1) {
        let href = seg.split('"').next().unwrap_or("");
        if href.starts_with(&needle) && href.ends_with(&format!("/{file}")) {
            let id = href[needle.len()..].split('/').next().unwrap_or("");
            // Prefer release builds ("<ts>_9.0") over nightly ("<ts>_N-…"); ts is first.
            let ts: u64 = id.split('_').next().and_then(|t| t.parse().ok()).unwrap_or(0);
            let is_release = !id.contains("_N-");
            let score = ts + if is_release { 1 << 40 } else { 0 };
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, format!("https://ffmpeg.martin-riedl.de{href}")));
            }
        }
    }
    best.map(|(_, u)| u).ok_or_else(|| "could not find an FFmpeg build to download".into())
}

async fn download(client: &reqwest::Client, url: &str, dest: &Path, tool: &str, report: &Report, from: f32, to: f32) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() { return Err(format!("download failed: HTTP {} for {url}", resp.status())); }
    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut got: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if last.elapsed().as_millis() > 150 {
            let pct = total.map(|t| from + (to - from) * (got as f32 / t as f32));
            report(ev(tool, Phase::Downloading, pct, format!("Downloading {} · {:.1} MB", dest.file_name().and_then(|n| n.to_str()).unwrap_or(""), got as f64 / 1048576.0)));
            last = std::time::Instant::now();
        }
    }
    Ok(())
}

fn unzip_binaries(zip_path: &Path, dest_dir: &Path, wanted: &[&str]) -> Result<Vec<PathBuf>, String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = Path::new(entry.name()).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let stem = name.trim_end_matches(".exe");
        if !wanted.contains(&stem) { continue; }
        let dest = dest_dir.join(&name);
        let mut o = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut o).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
        }
        out.push(dest);
    }
    Ok(out)
}

/// Download FFmpeg + ffprobe into `bin_dir`. Reports progress; returns installed paths.
pub async fn install_ffmpeg(bin_dir: &Path, report: &Report) -> Result<Vec<PathBuf>, String> {
    std::fs::create_dir_all(bin_dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().user_agent("Feather/0.1").build().map_err(|e| e.to_string())?;
    let urls = ffmpeg_urls()?;
    let n = urls.len() as f32;
    let mut installed = Vec::new();
    for (i, (name, url)) in urls.iter().enumerate() {
        let (from, to) = (i as f32 / n * 90.0, (i as f32 + 1.0) / n * 90.0);
        report(ev("ffmpeg", Phase::Downloading, Some(from), format!("Resolving {name}…")));
        let real = if url.contains("martin-riedl") { resolve_riedl(&client, url).await? } else { url.clone() };
        let tmp = bin_dir.join(format!(".{name}.zip.part"));
        download(&client, &real, &tmp, "ffmpeg", report, from, to).await?;
        report(ev("ffmpeg", Phase::Extracting, Some(to), format!("Extracting {name}…")));
        let mut got = unzip_binaries(&tmp, bin_dir, &["ffmpeg", "ffprobe"])?;
        let _ = std::fs::remove_file(&tmp);
        installed.append(&mut got);
    }
    #[cfg(target_os = "macos")]
    for p in &installed {
        let _ = std::process::Command::new("xattr").args(["-d", "com.apple.quarantine"]).arg(p).output();
    }
    // Sanity check: run it.
    let ff = bin_dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    let ok = std::process::Command::new(&ff).arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
    if !ok { return Err("downloaded FFmpeg does not run on this system".into()); }
    report(ev("ffmpeg", Phase::Done, Some(100.0), "FFmpeg installed"));
    Ok(installed)
}

/// Ghostscript: no static builds exist for macOS, so use Homebrew when present (macOS/Linux),
/// winget/official installer on Windows. Streams package-manager output as progress messages.
pub async fn install_ghostscript(report: &Report) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let cmd: Option<(&str, Vec<&str>)> = which::which("winget").ok().map(|_| ("winget", vec!["install", "-e", "--id", "ArtifexSoftware.GhostScript", "--accept-source-agreements", "--accept-package-agreements"]));
    #[cfg(not(target_os = "windows"))]
    let cmd: Option<(&str, Vec<&str>)> = {
        let brew = which::which("brew").ok()
            .or_else(|| ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/home/linuxbrew/.linuxbrew/bin/brew"].iter().map(PathBuf::from).find(|p| p.exists()));
        match brew {
            Some(_) => Some(("brew", vec!["install", "ghostscript"])),
            None => {
                #[cfg(target_os = "linux")]
                { which::which("apt-get").ok().map(|_| ("pkexec", vec!["apt-get", "install", "-y", "ghostscript"])) }
                #[cfg(not(target_os = "linux"))]
                { None }
            }
        }
    };
    let Some((prog, args)) = cmd else {
        return Err(if cfg!(target_os = "macos") {
            "Homebrew not found. Install Homebrew (https://brew.sh) and try again, or download Ghostscript from https://www.ghostscript.com/releases/gsdnld.html".into()
        } else { "No supported package manager found. Install Ghostscript from https://www.ghostscript.com/releases/gsdnld.html".into() });
    };
    let prog_path = which::which(prog).ok()
        .or_else(|| ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].iter().map(PathBuf::from).find(|p| p.exists() && prog == "brew"))
        .unwrap_or_else(|| PathBuf::from(prog));
    report(ev("ghostscript", Phase::Installing, None, format!("Running {prog} {}…", args.join(" "))));
    let mut child = tokio::process::Command::new(&prog_path).args(&args)
        .env("HOMEBREW_NO_AUTO_UPDATE", "1").env("HOMEBREW_NO_ENV_HINTS", "1")
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
        .spawn().map_err(|e| format!("failed to start {prog}: {e}"))?;
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut out = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut err = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut tail = String::new();
    loop {
        tokio::select! {
            l = out.next_line() => match l { Ok(Some(l)) => { report(ev("ghostscript", Phase::Installing, None, l.clone())); tail = l; } _ => break },
            l = err.next_line() => match l { Ok(Some(l)) => { tail = l; } _ => {} },
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("{prog} failed: {tail}")); }
    report(ev("ghostscript", Phase::Done, Some(100.0), "Ghostscript installed"));
    Ok(())
}
