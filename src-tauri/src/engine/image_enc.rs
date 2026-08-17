use super::probe::MediaInfo;
use super::settings::{ImageFormat, ImageSettings, Quality};
use super::tools::Tools;
use image::{DynamicImage, GenericImageView, ImageEncoder};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn output_ext(info: &MediaInfo, s: &ImageSettings) -> &'static str {
    match s.format {
        ImageFormat::Jpg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::Webp => "webp",
        ImageFormat::Avif => "avif",
        ImageFormat::Same => {
            let ext = Path::new(&info.path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            match ext.as_str() {
                "png" => "png",
                "webp" => "webp",
                "avif" => "avif",
                // heic / tiff / bmp / jpeg → jpg
                _ => "jpg",
            }
        }
    }
}

fn q_jpeg(q: Quality) -> u8 {
    match q { Quality::Highest => 92, Quality::High => 85, Quality::Good => 78, Quality::Medium => 70, Quality::Acceptable => 60 }
}
fn q_webp(q: Quality) -> f32 {
    match q { Quality::Highest => 92.0, Quality::High => 85.0, Quality::Good => 78.0, Quality::Medium => 70.0, Quality::Acceptable => 60.0 }
}
fn q_avif(q: Quality) -> f32 {
    match q { Quality::Highest => 85.0, Quality::High => 75.0, Quality::Good => 65.0, Quality::Medium => 55.0, Quality::Acceptable => 45.0 }
}

/// Decode with the `image` crate; fall back to ffmpeg / sips for HEIC/AVIF and friends.
fn decode(tools: &Tools, path: &Path) -> Result<DynamicImage, String> {
    match image::open(path) {
        Ok(img) => Ok(img),
        Err(first_err) => {
            let tmp: PathBuf = std::env::temp_dir().join(format!("feather-{}.png", uuid::Uuid::new_v4().simple()));
            let mut ok = false;
            if let Ok(ff) = tools.ffmpeg() {
                ok = Command::new(ff)
                    .args(["-hide_banner", "-y", "-nostdin", "-i"])
                    .arg(path)
                    .args(["-frames:v", "1"])
                    .arg(&tmp)
                    .output()
                    .map(|o| o.status.success() && tmp.exists())
                    .unwrap_or(false);
            }
            #[cfg(target_os = "macos")]
            if !ok {
                ok = Command::new("sips")
                    .args(["-s", "format", "png"])
                    .arg(path)
                    .arg("--out")
                    .arg(&tmp)
                    .output()
                    .map(|o| o.status.success() && tmp.exists())
                    .unwrap_or(false);
            }
            if !ok {
                return Err(format!("cannot decode image: {first_err}"));
            }
            let img = image::open(&tmp).map_err(|e| e.to_string());
            let _ = std::fs::remove_file(&tmp);
            img
        }
    }
}

fn flatten_on_white(img: &DynamicImage) -> image::RgbImage {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = image::RgbImage::new(w, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as f32 / 255.0;
        let blend = |c: u8| ((c as f32) * a + 255.0 * (1.0 - a)).round() as u8;
        out.put_pixel(x, y, image::Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
    }
    out
}

/// Blocking. Returns final (w,h). Writes to `out`.
pub fn compress(tools: &Tools, info: &MediaInfo, s: &ImageSettings, out: &Path) -> Result<(u32, u32), String> {
    let mut img = decode(tools, Path::new(&info.path))?;
    let (w, h) = img.dimensions();
    if let Some((nw, nh)) = s.resize.target(w, h) {
        img = img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3);
    }
    let (w, h) = img.dimensions();
    let ext = output_ext(info, s);
    let bytes: Vec<u8> = match ext {
        "jpg" => {
            // mozjpeg: progressive + trellis quantisation → ~20-30% smaller than baseline libjpeg at equal quality.
            let rgb = flatten_on_white(&img);
            let q = q_jpeg(s.quality);
            let data: Vec<u8> = std::panic::catch_unwind(move || {
                let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
                comp.set_size(w as usize, h as usize);
                comp.set_quality(q as f32);
                comp.set_progressive_mode();
                comp.set_optimize_scans(true);
                comp.set_use_scans_in_trellis(true);
                let mut c = comp.start_compress(Vec::new()).map_err(|e| e.to_string())?;
                c.write_scanlines(rgb.as_raw()).map_err(|e| e.to_string())?;
                c.finish().map_err(|e| e.to_string())
            })
            .map_err(|_| "jpeg encoder panicked".to_string())??;
            data
        }
        "png" => {
            // Reduce to 8-bit, drop alpha if fully opaque, then run oxipng (lossless).
            let has_alpha = img.color().has_alpha() && img.to_rgba8().pixels().any(|p| p[3] != 255);
            let mut buf = Cursor::new(Vec::new());
            {
                let enc = image::codecs::png::PngEncoder::new_with_quality(
                    &mut buf,
                    image::codecs::png::CompressionType::Fast,
                    image::codecs::png::FilterType::Adaptive,
                );
                if has_alpha {
                    let rgba = img.to_rgba8();
                    enc.write_image(rgba.as_raw(), w, h, image::ExtendedColorType::Rgba8).map_err(|e| e.to_string())?;
                } else {
                    let rgb = img.to_rgb8();
                    enc.write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8).map_err(|e| e.to_string())?;
                }
            }
            // Preset 2 is within ~1-2% of preset 4 but several times faster.
            let level = match s.quality { Quality::Highest => 3, _ => 2 };
            let mut opts = oxipng::Options::from_preset(level);
            opts.strip = if s.keep_metadata { oxipng::StripChunks::None } else { oxipng::StripChunks::Safe };
            opts.optimize_alpha = true;
            oxipng::optimize_from_memory(&buf.into_inner(), &opts).map_err(|e| e.to_string())?
        }
        "webp" => {
            let enc = webp::Encoder::from_image(&img).map_err(|e| e.to_string())?;
            let mem = enc.encode(q_webp(s.quality));
            mem.to_vec()
        }
        "avif" => {
            let rgba = img.to_rgba8();
            let px: Vec<rgb::RGBA8> = rgba.pixels().map(|p| rgb::RGBA8::new(p[0], p[1], p[2], p[3])).collect();
            let im = ravif::Img::new(px.as_slice(), w as usize, h as usize);
            let res = ravif::Encoder::new()
                .with_quality(q_avif(s.quality))
                .with_alpha_quality(q_avif(s.quality))
                .with_speed(if s.quality == Quality::Highest { 6 } else { 8 })
                .encode_rgba(im)
                .map_err(|e| e.to_string())?;
            res.avif_file
        }
        _ => return Err(format!("unsupported output format {ext}")),
    };
    // Never hand back a bigger file when the format didn't change and nothing was resized:
    // keep the original bytes instead (already as good as it gets).
    let same_format = Path::new(&info.path)
        .extension().and_then(|e| e.to_str())
        .map(|e| { let e = e.to_ascii_lowercase(); e == ext || (ext == "jpg" && e == "jpeg") })
        .unwrap_or(false);
    let resized = (w, h) != (info.width.unwrap_or(w), info.height.unwrap_or(h));
    if same_format && !resized && bytes.len() as u64 >= info.size {
        std::fs::copy(&info.path, out).map_err(|e| e.to_string())?;
        return Ok((w, h));
    }
    std::fs::write(out, bytes).map_err(|e| e.to_string())?;
    Ok((w, h))
}
