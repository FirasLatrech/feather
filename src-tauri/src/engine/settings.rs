use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Highest,
    High,
    #[default]
    Good,
    Medium,
    Acceptable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    #[default]
    H264,
    H265,
    Vp9,
    Av1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VideoFormat {
    #[default]
    Same,
    Mp4,
    Webm,
    Mov,
    Mkv,
    Gif,
    Mp3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    #[default]
    Same,
    Jpg,
    Png,
    Webp,
    Avif,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ResizeMode {
    #[default]
    None,
    Width,
    Height,
    LongEdge,
    ShortEdge,
    Percent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Resize {
    pub mode: ResizeMode,
    pub value: u32,
}

impl Resize {
    /// Compute target (w,h) from source dims. Never upscales.
    pub fn target(&self, w: u32, h: u32) -> Option<(u32, u32)> {
        if self.value == 0 {
            return None;
        }
        let v = self.value as f64;
        let (w_f, h_f) = (w as f64, h as f64);
        let scale = match self.mode {
            ResizeMode::None => return None,
            ResizeMode::Width => v / w_f,
            ResizeMode::Height => v / h_f,
            ResizeMode::LongEdge => v / w_f.max(h_f),
            ResizeMode::ShortEdge => v / w_f.min(h_f),
            ResizeMode::Percent => v / 100.0,
        };
        if scale >= 1.0 {
            return None;
        }
        let nw = ((w_f * scale).round() as u32).max(1);
        let nh = ((h_f * scale).round() as u32).max(1);
        Some((nw, nh))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct VideoSettings {
    pub quality: Quality,
    pub codec: VideoCodec,
    pub format: VideoFormat,
    pub hw_accel: bool,
    pub resize: Resize,
    pub fps: Option<u32>,
    pub remove_audio: bool,
    /// Target output size in MB (uses two-pass bitrate mode; overrides quality)
    pub target_size_mb: Option<f64>,
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    /// 0 = auto
    pub threads: u32,
}
impl Default for VideoSettings {
    fn default() -> Self {
        Self {
            quality: Quality::Good,
            codec: VideoCodec::H264,
            format: VideoFormat::Same,
            hw_accel: false,
            resize: Resize::default(),
            fps: None,
            remove_audio: false,
            target_size_mb: None,
            trim_start: None,
            trim_end: None,
            threads: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ImageSettings {
    pub quality: Quality,
    pub format: ImageFormat,
    pub resize: Resize,
    pub keep_metadata: bool,
}
impl Default for ImageSettings {
    fn default() -> Self {
        Self {
            quality: Quality::Good,
            format: ImageFormat::Same,
            resize: Resize::default(),
            keep_metadata: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GifSettings {
    pub quality: Quality,
    pub fps: u32,
    pub resize: Resize,
    pub loop_forever: bool,
}
impl Default for GifSettings {
    fn default() -> Self {
        Self {
            quality: Quality::Good,
            fps: 15,
            resize: Resize { mode: ResizeMode::Width, value: 640 },
            loop_forever: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PdfSettings {
    pub quality: Quality,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OutputLocation {
    #[default]
    SameFolder,
    Subfolder,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OutputSettings {
    pub location: OutputLocation,
    pub subfolder_name: String,
    pub custom_dir: String,
    /// Template vars: {name} {ext} {quality} {resolution} {date} {time} {codec}
    pub name_template: String,
    pub overwrite_original: bool,
    pub trash_original: bool,
    pub keep_dates: bool,
    /// If output isn't smaller, keep original copy instead
    pub skip_if_larger: bool,
}
impl Default for OutputSettings {
    fn default() -> Self {
        Self {
            location: OutputLocation::SameFolder,
            subfolder_name: "compressed".into(),
            custom_dir: String::new(),
            name_template: "{name}_compressed".into(),
            overwrite_original: false,
            trash_original: false,
            keep_dates: true,
            skip_if_larger: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub video: VideoSettings,
    pub image: ImageSettings,
    pub gif: GifSettings,
    pub pdf: PdfSettings,
    pub output: OutputSettings,
    pub concurrency: usize,
    pub notify_on_finish: bool,
    pub ffmpeg_path: Option<String>,
    pub gs_path: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            video: Default::default(),
            image: Default::default(),
            gif: Default::default(),
            pdf: Default::default(),
            output: Default::default(),
            concurrency: 2,
            notify_on_finish: true,
            ffmpeg_path: None,
            gs_path: None,
        }
    }
}
