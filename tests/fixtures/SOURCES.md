# Test fixtures

`audio-video.mp4` is a synthetic four-second solid-color video with a 440 Hz sine wave, generated for these tests. It contains no third-party recitation, photograph or music. Reproduce it with FFmpeg:

```sh
ffmpeg -f lavfi -i 'color=c=0x263123:s=180x320:r=30' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 4 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest audio-video.mp4
```

`damaged-recipe.txt` is an intentionally invalid serialized recipe regression fixture containing project settings, not audio, translation text or credentials.
