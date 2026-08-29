/**
 * Pull stills out of the sidebar motion reference.
 *
 * There is no ffmpeg on this machine, but there is a browser, and a browser
 * already knows how to decode the file. Ten evenly-spaced frames is enough to
 * read a transition: what the carve looks like at rest, and — the part a still
 * of the finished state cannot tell you — what its shape does in between two
 * rests.
 *
 * TWO THINGS HAD TO BE WORKED AROUND, both of which present as an infinite hang
 * or an empty PNG rather than as an error:
 *
 *   1. Playwright's bundled Chromium is the open-source build and ships NO
 *      proprietary codecs. It parses the MP4 container happily — it reports the
 *      duration to six decimal places — and then cannot decode a single H.264
 *      frame, so every `currentTime =` waits forever for a `seeked` that will
 *      never fire. Hence `channel: "msedge"`: a real Edge install, with codecs.
 *
 *   2. Reading frames back through `canvas.drawImage` + `toDataURL` crashes the
 *      renderer in headless Edge (GPU readback of a hardware-decoded surface).
 *      Screenshotting the <video> ELEMENT sidesteps the readback entirely —
 *      Playwright captures the composited frame, which is the thing we wanted a
 *      picture of anyway.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const src = path.resolve("../UI-UX/references/styleUpdate/dashboardSidebarAnimation.mp4");
const out = "design-lab-shots/ref-motion";
mkdirSync(out, { recursive: true });

const html = path.resolve("design-lab/.frames.html");
writeFileSync(
  html,
  `<body style="margin:0;background:#000">
<video id="v" muted playsinline style="display:block;width:100%"></video>
<script>
const v = document.getElementById("v");
window.__load = (u) => new Promise((res) => { v.src = u; v.onloadeddata = () => res([v.videoWidth, v.videoHeight, v.duration]); });
// Seeking to the position the video is ALREADY at fires no \`seeked\` event, so a
// seek to t=0 on a freshly-loaded video would wait forever.
window.__seek = (t) => new Promise((res) => {
  if (Math.abs(v.currentTime - t) < 0.001) { res(v.currentTime); return; }
  v.onseeked = () => res(v.currentTime);
  v.currentTime = t;
});
</script></body>`,
);

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(pathToFileURL(html).href);
const [w, h, duration] = await page.evaluate(
  (u) => window.__load(u),
  pathToFileURL(src).href,
);
console.log(`video ${w}x${h}, ${duration.toFixed(2)}s`);
await page.setViewportSize({ width: Math.min(1280, w), height: Math.min(900, h) });

const N = 10;
for (let i = 0; i < N; i++) {
  const t = (duration * i) / (N - 1);
  await page.evaluate((tt) => window.__seek(tt), Math.min(t, duration - 0.05));
  await page.waitForTimeout(120);
  await page
    .locator("#v")
    .screenshot({ path: `${out}/frame-${String(i).padStart(2, "0")}.png` });
}
console.log("wrote", N, "frames to", out);
await browser.close();
