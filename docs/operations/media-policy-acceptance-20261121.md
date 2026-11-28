# Media policy: acceptance measurements (PR #216, 2026-11-21)

Two checks that the unit tests cannot give: **colour accuracy** of the re-encoded original and **HLS playback on a
throttled link**. Local stack only; nothing was run against Acceptance or Production. The thresholds were not
loosened; everything above them is listed as a finding.

## 1. Colour accuracy (CIEDE2000, original vs re-encoded output)

Method: 384x384 test images (marble-like, wood-like, 48 colour swatches, a gradient ramp), each embedded as
sRGB, Display P3 (sharp's built-in profile) and Adobe RGB 1998 (a matrix/TRC profile built from the published
primaries, gamma 563/256), as lossless-ish JPEG (q100, 4:4:4) and PNG. The profile is embedded **without**
transforming the numbers. Each file goes through `sharpImageProcessor.reencodeOriginal` (the production
pipeline). Reference colours are computed independently of libvips/lcms (encoded RGB -> linear -> XYZ D50 ->
Lab, using the profile's own primaries and curve). dE2000 is evaluated on every pixel; "in-gamut" means the
source colour is inside the sRGB gamut (an sRGB image cannot hold the others: those pixels clip by definition).

| Source profile | Format | in-gamut pixels | mean dE | p99 dE | max dE |
|---|---|---|---|---|---|
| sRGB | PNG | 100% | 0.000 | 0.000 | 0.000 |
| sRGB | JPEG q90 | 100% | 0.00-0.55 | 1.5-2.3 | 3.1-4.0 |
| Display P3 | PNG | 42-100% | 0.13-0.29 | 0.40-0.43 | 0.43-0.73 |
| Display P3 | JPEG q90 | 42-100% | 0.28-1.0 | 1.0-2.8 | 1.0-5.3 |
| Adobe RGB | PNG | 47-100% | 0.13-0.22 | 0.28-0.67 | 0.28-0.85 |
| Adobe RGB | JPEG q90 | 47-100% | 0.32-0.74 | 0.85-2.9 | 0.85-5.9 |

Findings:

* **Profile conversion is right.** Wide-gamut sources land on the correct sRGB values (PNG, in-gamut: max dE 0.85,
  i.e. 8-bit rounding). The sRGB case is the identity.
* **JPEG q90 is not "dE < 2" everywhere.** Mean dE is at most 1.0 and p99 at most 2.9, but isolated pixels on hard
  edges (the marble veins, the steepest ramp transitions) reach 4-6. That is DCT quantisation at quality 90,
  not a colour-management error. Flagged, not hidden. Smooth areas (the wood grain, swatches) stay below 2.
* **Colours outside the sRGB gamut clip** (up to dE 7.6 for Display P3 and 10.7 for Adobe RGB in the saturated
  synthetic swatches/ramps: 33-58% of those pixels are outside sRGB). Inherent to an sRGB-only original.
  Real photographs are overwhelmingly inside sRGB. Decision for the owner if wide-gamut originals matter.
* **A real bug found and fixed (`cf6e0e56`).** The first run showed PNG originals with mean dE 3.7 / max 32 on
  gradients: sharp treats `png({ effort })` as `palette: true` and quantised the original to 256 colours.
  Fixed (`palette: false`) with a regression test that fails on the old code. The earlier
  "Display P3 is converted" unit test was also too weak (it asserted "not equal"); it is now a round trip of
  sRGB (200,100,50) through a Display P3 file that must come back within 2 levels.
* sharp's own ICC conversion (embedded profile -> sRGB) was checked separately and is correct.

Not covered: CMYK sources, 16-bit sources, and the Workers (Cloudflare Images) engine, which has no local
equivalent; its output is only checked for metadata stripping in the unit tests.

## 2. HLS playback on a throttled link

Method: the worker's own `probe` / `plan_renditions` / `transcode_command` / `normalize_outputs` (Linux
container, ffmpeg 5.1 / libx264) on a 45 s, 1920x1080, 30 fps, noisy test clip with audio. Ladder produced:
360p (about 0.47 Mbit/s average, 1.46 peak), 720p (2.4 average, 4.76 peak), 1080p (7.1 average, 8.39 peak), 12
fMP4 segments each. Playback in Chromium with hls.js 1.5.17 over a local server that shares one bandwidth bucket
and adds the round-trip time per request. Profiles: 4G 9 Mbit/s 70 ms; "Slow 4G" 1.6 Mbit/s 150 ms (Lighthouse);
"Fast 3G" 1.6 Mbit/s 562 ms and "Slow 3G" 0.5 Mbit/s 400 ms (DevTools). Each run plays 44 s of media with three
seeks (to 30 s, back to 5 s, to 40 s). Startup = `play()` to first `playing`.

| Profile / mode | Startup | Stalls | Rendition switching | Seek to unbuffered point | Dropped frames |
|---|---|---|---|---|---|
| 4G, auto | 0.9 s | none | stays 360p (no up-switch within 45 s) | 52-60 ms | 2 of 732 |
| 4G, 720p fixed | 2.2 s | none | none | 0.06-0.6 s | 0 of 730 |
| Slow 4G, auto | 4.7 s | none | 360p | 2.0 s (first), then buffered | 0 of 731 |
| Slow 4G, start at 720p | 10.5 s | 1 x 0.48 s | 720p -> 360p after 2.3 s | 2.2 s | 1 of 716 |
| Fast 3G, auto | 6.7 s | 1 x 0.37 s | 360p | 2.6 s / 1.4 s | 2 of 719 |
| Slow 3G (0.5 Mbit/s), auto | 14.0 s | **4 (2.1-8.1 s each)** | 360p | 6.5 s | 4 of 510 |

Findings:

* **720p plays cleanly where the link carries it** (4G: no stall, no seek breakage, no dropped frames, 14.1 MB
  for 45 s). No broken seeks, no decoder errors, no fatal player errors in any run.
* **Rendition switching works**: starting at 720p on a 1.6 Mbit/s link the player drops to 360p after one
  segment and recovers; on that link it never tried to climb back.
* **hls.js starts on the lowest rendition and did not climb to 720p on 9 Mbit/s within 45 s** (it fills the
  buffer from 360p first). A short video therefore never shows 720p on auto. Playback config (start level), not
  an encoder problem.
* **Slow 3G stalls.** 0.5 Mbit/s is below the 360p rendition's own average plus audio and overhead, and there is
  no lower rung. 4 stalls of 2-8 s in 44 s of playback. Adding a 240p rung (about 0.25 Mbit/s) would fix it; that
  is a product decision (more storage and encode time per video), not made here.
* Startup is dominated by round trips plus the first segment (segments are about 4 s); on the 562 ms link it is
  6-7 s.

Reproduction material (harness, server, player page, raw reports) is in the session notes folder of this
work; the transcode step uses only the worker's own functions.
