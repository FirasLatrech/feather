//! `feather-cli` — command-line + MCP (Model Context Protocol) front-end for the Feather engine.
//!
//!   feather-cli compress <files...> [--quality good] [--format mp4] [--max 1920] [--out DIR] [--replace]
//!   feather-cli probe <files...>
//!   feather-cli estimate <files...> [same options as compress]
//!   feather-cli history [--limit 50]
//!   feather-cli mcp            # stdio MCP server (tools: compress, probe, estimate, history)
use clap::{Args, Parser, Subcommand};
use feather_lib::engine::probe::{kind_from_ext, probe, MediaInfo, MediaKind};
use feather_lib::engine::run::{run_compression, Hooks};
use feather_lib::engine::settings::*;
use feather_lib::engine::{estimate, Tools};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

#[derive(Parser)]
#[command(name = "feather-cli", version, about = "Feather — make videos, images, GIFs and PDFs lighter, on-device")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args, Clone, Default, Debug)]
struct Opts {
    /// highest | high | good | medium | acceptable
    #[arg(long)]
    quality: Option<String>,
    /// Video: same|mp4|mov|webm|mkv|gif|mp3 · Image: same|jpg|png|webp|avif
    #[arg(long)]
    format: Option<String>,
    /// Longest side in pixels (never upscales)
    #[arg(long)]
    max: Option<u32>,
    /// Output directory (default: next to the input)
    #[arg(long)]
    out: Option<String>,
    /// Replace the original file in place
    #[arg(long)]
    replace: bool,
    /// Remove audio track (video)
    #[arg(long)]
    no_audio: bool,
    /// Video codec: auto|h264|h265|vp9|av1
    #[arg(long)]
    codec: Option<String>,
    /// Target size in MB (video, two-pass)
    #[arg(long)]
    target_mb: Option<f64>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compress files
    Compress { files: Vec<String>, #[command(flatten)] opts: Opts, /// Emit JSON lines
    #[arg(long)] json: bool },
    /// Show media info as JSON
    Probe { files: Vec<String> },
    /// Estimate output size / time as JSON
    Estimate { files: Vec<String>, #[command(flatten)] opts: Opts },
    /// Print compression history as JSON
    History { #[arg(long, default_value_t = 50)] limit: usize },
    /// Run as an MCP server over stdio
    Mcp,
}

fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("tn.horizon-tech.feather")
}
fn load_settings() -> Settings {
    std::fs::read(config_dir().join("settings.json")).ok()
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .map(Settings::migrate)
        .unwrap_or_default()
}
fn parse_quality(q: &str) -> Result<Quality, String> {
    Ok(match q.to_ascii_lowercase().as_str() {
        "highest" => Quality::Highest, "high" => Quality::High, "good" => Quality::Good,
        "medium" => Quality::Medium, "acceptable" | "low" | "smallest" => Quality::Acceptable,
        other => return Err(format!("unknown quality '{other}' (highest|high|good|medium|acceptable)")),
    })
}
fn apply_opts(mut s: Settings, o: &Opts) -> Result<Settings, String> {
    // Destructive behaviour is never inherited from the GUI settings: only when asked explicitly.
    s.output.overwrite_original = o.replace;
    s.output.trash_original = false;
    if let Some(q) = &o.quality {
        let q = parse_quality(q)?;
        s.video.quality = q; s.image.quality = q; s.gif.quality = q; s.pdf.quality = q;
    }
    if let Some(f) = &o.format {
        match f.to_ascii_lowercase().as_str() {
            "same" => { s.video.format = VideoFormat::Same; s.image.format = ImageFormat::Same; }
            "mp4" => s.video.format = VideoFormat::Mp4, "mov" => s.video.format = VideoFormat::Mov,
            "webm" => s.video.format = VideoFormat::Webm, "mkv" => s.video.format = VideoFormat::Mkv,
            "gif" => s.video.format = VideoFormat::Gif, "mp3" => s.video.format = VideoFormat::Mp3,
            "jpg" | "jpeg" => s.image.format = ImageFormat::Jpg, "png" => s.image.format = ImageFormat::Png,
            "webp" => s.image.format = ImageFormat::Webp, "avif" => s.image.format = ImageFormat::Avif,
            other => return Err(format!("unknown format '{other}'")),
        }
    }
    if let Some(m) = o.max {
        let r = Resize { mode: ResizeMode::LongEdge, value: m };
        s.video.resize = r; s.image.resize = r; s.gif.resize = r;
    }
    if let Some(dir) = &o.out {
        s.output.location = OutputLocation::Custom; s.output.custom_dir = dir.clone();
    }
    if o.replace { s.output.overwrite_original = true; }
    if o.no_audio { s.video.remove_audio = true; }
    if let Some(c) = &o.codec {
        s.video.codec = match c.to_ascii_lowercase().as_str() {
            "auto" => VideoCodec::Auto, "h264" | "avc" => VideoCodec::H264, "h265" | "hevc" => VideoCodec::H265,
            "vp9" => VideoCodec::Vp9, "av1" => VideoCodec::Av1,
            other => return Err(format!("unknown codec '{other}'")),
        };
    }
    if let Some(mb) = o.target_mb { s.video.target_size_mb = Some(mb); }
    Ok(s)
}

fn expand(paths: &[String]) -> Vec<PathBuf> {
    fn walk(p: &Path, out: &mut Vec<PathBuf>, depth: usize) {
        if depth > 8 { return; }
        if p.is_dir() {
            if let Ok(rd) = std::fs::read_dir(p) {
                let mut v: Vec<_> = rd.flatten().map(|e| e.path()).collect(); v.sort();
                for e in v {
                    let n = e.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if n.starts_with('.') || n == "node_modules" { continue; }
                    walk(&e, out, depth + 1);
                }
            }
        } else if kind_from_ext(p) != MediaKind::Unknown { out.push(p.to_path_buf()); }
    }
    let mut out = Vec::new();
    for p in paths { walk(Path::new(p), &mut out, 0); }
    out
}

fn info_json(i: &MediaInfo) -> Value { serde_json::to_value(i).unwrap_or(Value::Null) }

async fn do_probe(tools: &Tools, paths: &[String]) -> Vec<Value> {
    let mut v = Vec::new();
    for p in expand(paths) {
        match probe(tools, &p).await {
            Ok(i) => v.push(info_json(&i)),
            Err(e) => v.push(json!({"path": p, "error": e})),
        }
    }
    v
}

async fn do_compress(tools: &Tools, paths: &[String], settings: &Settings, mut on_progress: impl FnMut(&str, f32, Option<f32>, Option<f64>)) -> Vec<Value> {
    let mut results = Vec::new();
    for p in expand(paths) {
        let info = match probe(tools, &p).await { Ok(i) => i, Err(e) => { results.push(json!({"input": p, "ok": false, "error": e})); continue; } };
        let name = info.path.clone();
        let out_path = Arc::new(Mutex::new(None::<String>));
        let op = out_path.clone();
        let (tx, rx) = std::sync::mpsc::channel::<(f32, Option<f32>, Option<f64>)>();
        let progress = move |p: f32, s: Option<f32>, e: Option<f64>| { let _ = tx.send((p, s, e)); };
        let output_path = move |p: &Path| { *op.lock().unwrap() = Some(p.to_string_lossy().to_string()); };
        let start = std::time::Instant::now();
        let fut = run_compression(tools, &info, settings, Hooks { progress: &progress, output_path: &output_path }, Arc::new(Notify::new()), Arc::new(AtomicBool::new(false)));
        tokio::pin!(fut);
        let res = loop {
            tokio::select! {
                r = &mut fut => break r,
                _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {
                    while let Ok((p, s, e)) = rx.try_recv() { on_progress(&name, p, s, e); }
                }
            }
        };
        let elapsed = start.elapsed().as_secs_f64();
        match res {
            Ok(d) => {
                let sav = if info.size > 0 { (info.size as f64 - d.size as f64) / info.size as f64 * 100.0 } else { 0.0 };
                results.push(json!({"input": info.path, "output": d.path, "ok": true, "input_size": info.size, "output_size": d.size,
                    "saved_percent": (sav * 10.0).round() / 10.0, "width": d.dims.map(|d| d.0), "height": d.dims.map(|d| d.1), "elapsed_secs": (elapsed * 10.0).round() / 10.0}));
            }
            Err(e) => results.push(json!({"input": info.path, "ok": false, "error": e})),
        }
    }
    results
}

fn history_json(limit: usize) -> Value {
    let items: Vec<Value> = std::fs::read(config_dir().join("history.json")).ok()
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok()).unwrap_or_default();
    let n = items.len().saturating_sub(limit);
    Value::Array(items[n..].to_vec())
}

// ───────────────────────────── MCP (stdio, JSON-RPC 2.0) ─────────────────────────────

fn tool_defs() -> Value {
    let opts = json!({
        "quality": {"type": "string", "enum": ["highest", "high", "good", "medium", "acceptable"], "description": "Quality preset (default: user's Feather setting, usually 'good')"},
        "format": {"type": "string", "description": "Output format. Video: same|mp4|mov|webm|gif|mp3. Image: same|jpg|png|webp|avif"},
        "max": {"type": "integer", "description": "Longest side in pixels; never upscales (e.g. 1920 for 1080p, 1280 for 720p)"},
        "out": {"type": "string", "description": "Output directory. Default: next to the input file"},
        "replace": {"type": "boolean", "description": "Replace the original file in place (irreversible)"},
        "no_audio": {"type": "boolean", "description": "Remove the audio track (video)"},
        "codec": {"type": "string", "enum": ["auto", "h264", "h265", "vp9", "av1"], "description": "Video codec; auto keeps the source codec"},
        "target_mb": {"type": "number", "description": "Target file size in MB (video, two-pass)"}
    });
    let mut compress_props = serde_json::Map::new();
    compress_props.insert("paths".into(), json!({"type": "array", "items": {"type": "string"}, "description": "Absolute paths of files or folders to compress"}));
    for (k, v) in opts.as_object().unwrap() { compress_props.insert(k.clone(), v.clone()); }
    json!([
        {"name": "compress", "description": "Compress videos (mp4/mov/mkv/webm…), images (jpg/png/webp/avif/heic), GIFs and PDFs on this machine using Feather. Returns per-file results with sizes and savings. Long videos can take minutes.",
         "inputSchema": {"type": "object", "properties": compress_props, "required": ["paths"]}},
        {"name": "probe", "description": "Get media info (kind, size, dimensions, duration, codec, fps, audio) for files or folders.",
         "inputSchema": {"type": "object", "properties": {"paths": {"type": "array", "items": {"type": "string"}}}, "required": ["paths"]}},
        {"name": "estimate", "description": "Estimate the output size and encode time before compressing (fast, no encoding). Same options as compress.",
         "inputSchema": {"type": "object", "properties": compress_props, "required": ["paths"]}},
        {"name": "history", "description": "Recent Feather compression history (inputs, outputs, sizes, dates).",
         "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 50}}}}
    ])
}

fn opts_from(args: &Value) -> Opts {
    Opts {
        quality: args.get("quality").and_then(|v| v.as_str()).map(String::from),
        format: args.get("format").and_then(|v| v.as_str()).map(String::from),
        max: args.get("max").and_then(|v| v.as_u64()).map(|v| v as u32),
        out: args.get("out").and_then(|v| v.as_str()).map(String::from),
        replace: args.get("replace").and_then(|v| v.as_bool()).unwrap_or(false),
        no_audio: args.get("no_audio").and_then(|v| v.as_bool()).unwrap_or(false),
        codec: args.get("codec").and_then(|v| v.as_str()).map(String::from),
        target_mb: args.get("target_mb").and_then(|v| v.as_f64()),
    }
}
fn paths_from(args: &Value) -> Vec<String> {
    args.get("paths").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

async fn mcp_call(tools: &Tools, name: &str, args: &Value, notify: &(dyn Fn(Value) + Sync), token: Option<Value>) -> Result<Value, String> {
    match name {
        "probe" => Ok(json!(do_probe(tools, &paths_from(args)).await)),
        "history" => Ok(history_json(args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize)),
        "estimate" => {
            let s = apply_opts(load_settings(), &opts_from(args))?;
            let mut v = Vec::new();
            for p in expand(&paths_from(args)) {
                if let Ok(i) = probe(tools, &p).await { v.push(serde_json::to_value(estimate::estimate(&i, &s)).unwrap()); }
            }
            Ok(json!(v))
        }
        "compress" => {
            let paths = paths_from(args);
            if paths.is_empty() { return Err("paths is required".into()); }
            let s = apply_opts(load_settings(), &opts_from(args))?;
            let res = do_compress(tools, &paths, &s, |file, p, sp, _eta| {
                if let Some(t) = &token {
                    notify(json!({"jsonrpc": "2.0", "method": "notifications/progress", "params": {"progressToken": t, "progress": p, "total": 100, "message": format!("{} · {:.0}%{}", Path::new(file).file_name().and_then(|n| n.to_str()).unwrap_or(file), p, sp.map(|s| format!(" · {s:.1}×")).unwrap_or_default())}}));
                }
            }).await;
            Ok(json!(res))
        }
        other => Err(format!("unknown tool {other}")),
    }
}

async fn mcp_serve(tools: Tools) {
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    let send = {
        let stdout = stdout.clone();
        move |v: Value| { let mut o = stdout.lock().unwrap(); let _ = writeln!(o, "{}", v); let _ = o.flush(); }
    };
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() { continue; }
        let msg: Value = match serde_json::from_str(&line) { Ok(v) => v, Err(_) => continue };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        let reply = |result: Value| json!({"jsonrpc": "2.0", "id": id, "result": result});
        match method {
            "initialize" => send(reply(json!({"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "feather", "version": env!("CARGO_PKG_VERSION")}}))),
            "notifications/initialized" | "notifications/cancelled" => {}
            "ping" => send(reply(json!({}))),
            "tools/list" => send(reply(json!({"tools": tool_defs()}))),
            "tools/call" => {
                let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let token = params.get("_meta").and_then(|m| m.get("progressToken")).cloned();
                let out = mcp_call(&tools, &name, &args, &send, token).await;
                match out {
                    Ok(v) => send(reply(json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap()}], "isError": false}))),
                    Err(e) => send(reply(json!({"content": [{"type": "text", "text": e}], "isError": true}))),
                }
            }
            _ => { if id.is_some() { send(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("method not found: {method}")}})); } }
        }
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let tools = {
        let s = load_settings();
        let mut t = Tools::detect();
        if let Some(p) = s.ffmpeg_path.filter(|p| Path::new(p).exists()) { t.ffmpeg = Some(PathBuf::from(p)); }
        if let Some(p) = s.gs_path.filter(|p| Path::new(p).exists()) { t.ghostscript = Some(PathBuf::from(p)); }
        t
    };
    match cli.cmd {
        Cmd::Probe { files } => println!("{}", serde_json::to_string_pretty(&do_probe(&tools, &files).await).unwrap()),
        Cmd::History { limit } => println!("{}", serde_json::to_string_pretty(&history_json(limit)).unwrap()),
        Cmd::Estimate { files, opts } => {
            let s = match apply_opts(load_settings(), &opts) { Ok(s) => s, Err(e) => { eprintln!("{e}"); std::process::exit(2); } };
            let mut v = Vec::new();
            for p in expand(&files) { if let Ok(i) = probe(&tools, &p).await { v.push(estimate::estimate(&i, &s)); } }
            println!("{}", serde_json::to_string_pretty(&v).unwrap());
        }
        Cmd::Compress { files, opts, json: as_json } => {
            let s = match apply_opts(load_settings(), &opts) { Ok(s) => s, Err(e) => { eprintln!("{e}"); std::process::exit(2); } };
            let res = do_compress(&tools, &files, &s, |file, p, sp, eta| {
                if as_json { println!("{}", json!({"event": "progress", "file": file, "percent": p, "speed": sp, "eta_secs": eta})); }
                else { eprint!("\r{:<40} {:5.1}%{}   ", Path::new(file).file_name().and_then(|n| n.to_str()).unwrap_or(file), p, sp.map(|s| format!(" · {s:.1}×")).unwrap_or_default()); }
            }).await;
            if !as_json { eprintln!(); }
            for r in &res {
                if as_json { println!("{}", json!({"event": "done", "result": r})); }
                else if r["ok"].as_bool() == Some(true) {
                    println!("✓ {}  {} → {}  (−{}%)  → {}", r["input"].as_str().unwrap_or(""), human(r["input_size"].as_u64().unwrap_or(0)), human(r["output_size"].as_u64().unwrap_or(0)), r["saved_percent"], r["output"].as_str().unwrap_or(""));
                } else {
                    eprintln!("✗ {}: {}", r["input"].as_str().unwrap_or(""), r["error"].as_str().unwrap_or("failed"));
                }
            }
            if res.iter().any(|r| r["ok"].as_bool() != Some(true)) { std::process::exit(1); }
        }
        Cmd::Mcp => mcp_serve(tools).await,
    }
}

fn human(n: u64) -> String {
    let f = n as f64;
    if f < 1024.0 { format!("{n} B") } else if f < 1048576.0 { format!("{:.1} KB", f / 1024.0) } else if f < 1073741824.0 { format!("{:.1} MB", f / 1048576.0) } else { format!("{:.2} GB", f / 1073741824.0) }
}
