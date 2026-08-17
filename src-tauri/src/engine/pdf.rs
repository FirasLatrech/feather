use super::settings::Quality;
use std::path::Path;

pub fn preset(q: Quality) -> &'static str {
    match q {
        Quality::Highest => "/prepress",
        Quality::High => "/printer",
        Quality::Good => "/ebook",
        Quality::Medium => "/ebook",
        Quality::Acceptable => "/screen",
    }
}

/// Extra image-downsampling tweaks so Good/Medium differ meaningfully.
fn dpi(q: Quality) -> Option<u32> {
    match q {
        Quality::Highest => None,
        Quality::High => Some(200),
        Quality::Good => Some(150),
        Quality::Medium => Some(110),
        Quality::Acceptable => Some(72),
    }
}

pub fn build_args(input: &Path, out: &Path, q: Quality) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-sDEVICE=pdfwrite".into(),
        "-dCompatibilityLevel=1.5".into(),
        format!("-dPDFSETTINGS={}", preset(q)),
        "-dNOPAUSE".into(),
        "-dBATCH".into(),
        "-dSAFER".into(),
        "-dDetectDuplicateImages=true".into(),
        "-dCompressFonts=true".into(),
        "-dSubsetFonts=true".into(),
    ];
    if let Some(d) = dpi(q) {
        a.extend([
            "-dDownsampleColorImages=true".into(),
            "-dDownsampleGrayImages=true".into(),
            "-dDownsampleMonoImages=true".into(),
            format!("-dColorImageResolution={d}"),
            format!("-dGrayImageResolution={d}"),
            format!("-dMonoImageResolution={}", (d * 2).max(150)),
        ]);
    }
    a.push(format!("-sOutputFile={}", out.to_string_lossy()));
    a.push(input.to_string_lossy().to_string());
    a
}
