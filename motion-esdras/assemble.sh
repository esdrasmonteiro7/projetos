#!/usr/bin/env bash
# Final assembly: 12 segments + 6 frame-exact transition patches + final audio mix
set -euo pipefail
cd "$(dirname "$0")"
OUT=/home/user/projetos/motion-esdras/esdras-solucoes-motion-9x16.mp4
for k in $(seq -w 0 11); do echo "file 'segs2/seg_$k.mp4'"; done > list2.txt
ffmpeg -v error -y -f concat -safe 0 -i list2.txt -c copy full_v2.mp4
echo "full frames: $(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 full_v2.mp4)"
# patch ranges [start, end)
P=( "501 539 p1" "602 638 p2" "738 772 p3" "902 935 p4" "1092 1134 p5" "1498 1527 p6" )
inputs=(-i full_v2.mp4)
fc="[0:v]split=7"
for i in $(seq 0 6); do fc+="[s$i]"; done
fc+=";"
prev=0; idx=1; chain=""
for i in "${!P[@]}"; do
  read -r a b name <<<"${P[$i]}"
  inputs+=(-i "patches/$name.mp4")
  fc+="[s$i]trim=start_frame=$prev:end_frame=$a,setpts=PTS-STARTPTS[f$i];"
  fc+="[$idx:v]trim=end_frame=$((b - a)),setpts=PTS-STARTPTS[q$i];"
  chain+="[f$i][q$i]"
  prev=$b; idx=$((idx + 1))
done
fc+="[s6]trim=start_frame=$prev:end_frame=1980,setpts=PTS-STARTPTS[f6];"
chain+="[f6]"
fc+="${chain}concat=n=13:v=1:a=0[v]"
ffmpeg -v error -y "${inputs[@]}" -i mix3.wav -filter_complex "$fc" -map "[v]" -map "$idx:a" \
  -c:v libx264 -preset slow -crf 18 -profile:v high -level 4.2 -pix_fmt yuv420p -g 120 -r 60 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart -t 33 "$OUT"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,nb_frames -of default=nw=1 "$OUT"
