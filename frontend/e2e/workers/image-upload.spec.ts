import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../helpers/auth";

/**
 * A large camera-like JPEG (6000 x 4000, per-pixel noise, > 10 MB) added to the
 * portfolio through the WORKERS build: the browser prepares it, uploads it to the
 * S3 stand-in, and the finalize action verifies it and writes thumb/card/full WebP
 * variants with the Images binding (no sharp in workerd). Asserts the receipt,
 * the recorded manifest, and the three stored variants (WebP, size, no metadata),
 * then deletes the work through the UI.
 */
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const OWNER_EMAIL = "heba@example.test";
const BUCKET = process.env.E2E_S3_BUCKET ?? "aladdin-local-private";
const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';

const scalar = (query: string) => execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA",
  "-v", "ON_ERROR_STOP=1", "-c", query]).toString().trim();
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

const s3 = new S3Client({ endpoint: process.env.E2E_S3_ENDPOINT ?? "http://127.0.0.1:8333", region: "auto", forcePathStyle: true,
  credentials: { accessKeyId: process.env.E2E_S3_ACCESS_KEY ?? "localtestaccess", secretAccessKey: process.env.E2E_S3_SECRET_KEY ?? "localtestsecretkey0123456789" } });
const workdir = mkdtempSync(path.join(tmpdir(), "workers-media-"));

async function signIn(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }));
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: test.info().project.use.baseURL! }]);
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$/i).fill(OWNER_EMAIL);
  await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { waitUntil: "commit", timeout: 60_000 });
}

async function signInAndAddWork(page: Page, file: string): Promise<{ key: string; title: string }> {
  await signIn(page);
  const title = `Workers photo ${randomBytes(3).toString("hex")}`;
  await page.goto("/home/profile/portfolio");
  await page.getByRole("button", { name: "Add work" }).first().click();
  await page.locator("#new-title").fill(title);
  await page.locator('form input[type="file"]').setInputFiles(file);
  await page.locator("form").getByRole("button", { name: "Add work" }).click();
  await expect(page.locator("li").filter({ has: page.getByRole("heading", { name: title }) })).toBeVisible({ timeout: 120_000 });
  const key = scalar(`select object_key from public.portfolio_items where title = ${lit(title)} and state = 'ready'`);
  expect(key).not.toBe("");
  return { key, title };
}

/** Deletes the work through the UI, as an owner would: the original and its variants leave storage. */
async function removeWork(page: Page, { key, title }: { key: string; title: string }) {
  const card = page.getByTestId("portfolio-manager").locator("li").filter({ hasText: title });
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `v/portfolio/${key}/` }))).KeyCount ?? 0).toBe(0);
}

/** Receipt, manifest and the three stored WebP variants; returns the stored original's type and the variant sizes. */
async function expectVerifiedWithVariants(key: string, sizes: Record<"thumb" | "card" | "full", [number, number]>) {
  const [provider, verified, hash, contentType] = scalar(`select provider || '|' || (verified_at is not null) || '|' || length(sha256) || '|' || content_type
    from public.media_storage_locations where namespace = 'portfolio' and object_key = ${lit(key)}`).split("|");
  expect([provider, verified, hash]).toEqual(["r2", "true", "64"]);
  const manifest = JSON.parse(scalar(`select variants::text from public.media_storage_locations
    where namespace = 'portfolio' and object_key = ${lit(key)}`)) as Record<string, { width: number; height: number; size: number }>;
  expect(Object.keys(manifest).sort()).toEqual(["card", "full", "thumb"]);
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `v/portfolio/${key}/` }));
  expect((listed.Contents ?? []).map((o) => o.Key).sort()).toEqual(["card", "full", "thumb"].map((v) => `v/portfolio/${key}/${v}.webp`));
  for (const variant of ["thumb", "card", "full"] as const) {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `v/portfolio/${key}/${variant}.webp` }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif, meta.orientation]).toEqual(["webp", ...sizes[variant], undefined, undefined]);
    expect([bytes.byteLength, manifest[variant]!.width, manifest[variant]!.height]).toEqual([manifest[variant]!.size, ...sizes[variant]]);
    test.info().annotations.push({ type: variant, description: `${meta.width}x${meta.height}, ${bytes.byteLength} bytes` });
  }
  return contentType;
}

test("large JPEG (6000 x 4000, > 10 MB): verified, three WebP variants stored", async ({ page }) => {
  const big = path.join(workdir, "big.jpg");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=6000x4000", "-vf", "noise=alls=80:allf=t",
    "-frames:v", "1", "-q:v", "1", big]);
  expect(statSync(big).size).toBeGreaterThan(10 * 1024 * 1024);
  const work = await signInAndAddWork(page, big);
  // The browser prepares a 2560 px derivative (lib/media/resize-image.ts); the server verifies that.
  const stored = await expectVerifiedWithVariants(work.key, { thumb: [320, 213], card: [768, 512], full: [1600, 1067] });
  test.info().annotations.push({ type: "stored original", description: stored });
  await removeWork(page, work);
});

test("small JPEG kept as-is, EXIF orientation 6: verified as JPEG, variants upright", async ({ page }) => {
  const file = path.join(workdir, "rotated.jpg");
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 40, g: 120, b: 200 } } })
    .withMetadata({ orientation: 6 }).jpeg({ quality: 80 }).toFile(file);
  const work = await signInAndAddWork(page, file);
  expect(await expectVerifiedWithVariants(work.key, { thumb: [320, 480], card: [768, 1152], full: [1200, 1800] })).toBe("image/jpeg");
  await removeWork(page, work);
});

test("video multipart through the Workers build: create, sign, list, complete, read head, delete", async ({ page }) => {
  // S3 XML responses (CreateMultipartUpload, ListParts, CompleteMultipartUpload) are parsed in workerd here.
  const file = path.join(workdir, "clip.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10", "-t", "1",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", file]);
  const bytes = readFileSync(file);
  await signIn(page);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const api = (method: "GET" | "POST" | "DELETE", url: string, data?: unknown) =>
    page.request.fetch(url, { method, headers: { origin, "content-type": "application/json" }, data });
  const begin = await api("POST", "/api/video/uploads", { scope: "portfolio", title: `Workers video ${randomBytes(3).toString("hex")}`,
    contentType: "video/mp4", bytes: bytes.byteLength });
  expect(begin.status()).toBe(201);
  const plan = await begin.json() as { id: string; partCount: number };
  expect(plan.partCount).toBe(1);
  try {
    const signed = await api("POST", `/api/video/uploads/${plan.id}/parts`, { parts: [1] });
    expect(signed.status()).toBe(200);
    const { urls } = await signed.json() as { urls: Record<string, string> };
    const put = await fetch(urls["1"]!, { method: "PUT", body: bytes, headers: { "content-length": String(bytes.byteLength) } });
    expect(put.status).toBe(200);
    const status = await (await api("GET", `/api/video/uploads/${plan.id}`)).json() as { uploaded: number[] };
    expect(status.uploaded).toEqual([1]);
    const complete = await api("POST", `/api/video/uploads/${plan.id}/complete`);
    expect([complete.status(), await complete.json()]).toEqual([200, { state: "processing" }]);
  } finally {
    expect((await api("DELETE", `/api/video/${plan.id}`)).status()).toBe(200);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `video/${plan.id}/original` }));
  }
});
