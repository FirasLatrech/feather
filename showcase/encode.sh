#!/bin/sh
# WebM → MP4 (for LinkedIn/X) and high-quality GIF (README/product pages).
set -e
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -i rec/tour.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart -vf "scale=1280:-2" out/feather-tour.mp4
ffmpeg -hide_banner -loglevel error -y -i rec/tour.webm -vf "fps=15,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=200:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" out/feather-tour.gif
ffmpeg -hide_banner -loglevel error -y -i rec/tour.webm -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" out/feather-tour-small.gif
ls -la out/
