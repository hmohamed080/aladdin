import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { E2E_PASSWORD } from "../helpers/auth";
import { startLocalEdge, type LocalEdge } from "../helpers/local-media-edge";

/**
 * R2 image path on the isolated local stack (playwright.video.config.ts):
 *
 *   * UPLOAD: a portfolio photograph goes browser -> storage with a presigned PUT,
 *     is verified, stored as an R2 row with a sha256 receipt, and gets WebP variants;
 *   * RETRIEVAL: the manager page renders it from the edge origin (/m/, ticketed),
 *     the database authorizing that request; the app origin serves no bytes;
 *   * DELETION: deleting the work refuses the same URL at once and removes the
 *     original and its variants from storage;
 *   * ROLLBACK (E2E_R2_ROLLBACK=1, second run with R2_STORAGE_ENABLED=false): a
 *     photo stored in R2 keeps rendering from R2, and a new upload goes to Supabase
 *     Storage. Turning R2 off never strands R2 media.
 */
const env = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} missing`); return v; };
const OWNER_EMAIL = "heba@example.test";
const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';
const KEEP_TITLE = "E2E R2 rollback keeper";
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const appOrigin = "http://127.0.0.1:3200";
const ROLLBACK = process.env.E2E_R2_ROLLBACK === "1";
const SHOTS = process.env.VIDEO_E2E_SHOTS ?? "/mnt/project-files/showroom-admin/e2e/video";

test.describe.configure({ mode: "serial" });

function scalar(query: string): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query])
    .toString().trim();
}
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

let edge: LocalEdge;
let s3: S3Client;
let role: string;
let workdir: string;

async function photo(file: string, hue: number) {
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } })
    .jpeg({ quality: 80 }).toFile(file);
}

async function context(browser: Browser, info: TestInfo) {
  const device = { ...info.project.use };
  delete device.defaultBrowserType;
  const ctx = await browser.newContext({ ...device, baseURL: appOrigin, ignoreHTTPSErrors: true, locale: "en-US" });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: appOrigin }]);
  await ctx.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }));
  return ctx;
}

async function signIn(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$/i).fill(OWNER_EMAIL);
  await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
  const captcha = page.locator('input[name="captchaToken"]');
  if (await captcha.count()) await expect(captcha).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { waitUntil: "commit", timeout: 30_000 });
}

async function addWork(page: Page, title: string, file: string) {
  await page.goto("/home/profile/portfolio");
  const manager = page.getByTestId("portfolio-manager");
  await manager.getByRole("button", { name: "Add work" }).first().click();
  await page.locator("#new-title").fill(title);
  await page.locator('input[type="file"]').filter({ visible: true }).first().setInputFiles(file);
  await page.getByRole("button", { name: "Add work" }).last().click();
  const card = manager.locator("li").filter({ hasText: title });
  await expect(card.locator("img")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  return card;
}

async function keys(prefix: string) {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: env("E2E_S3_BUCKET"), Prefix: prefix }));
  return (out.Contents ?? []).map((o) => o.Key!);
}

test.beforeAll(async () => {
  workdir = mkdtempSync(path.join(tmpdir(), "r2-e2e-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", `${workdir}/key.pem`, "-out", `${workdir}/cert.pem`], { stdio: "ignore" });
  // LOCAL TEST DB ONLY, as e2e/global-setup.ts: give the seeded owner the known E2E password if it has none.
  scalar(`update auth.users set encrypted_password = extensions.crypt(${lit(E2E_PASSWORD)}, extensions.gen_salt('bf'))
    where email = ${lit(OWNER_EMAIL)} and coalesce(encrypted_password, '') = ''`);
  role = `media_edge_e2e_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(18).toString("base64url");
  scalar(`create role ${role} login password '${password}' in role media_edge`);
  const db = new URL(env("E2E_DB_URL")); db.username = role; db.password = password;
  s3 = new S3Client({ endpoint: env("E2E_S3_ENDPOINT"), region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: env("E2E_S3_ACCESS_KEY"), secretAccessKey: env("E2E_S3_SECRET_KEY") } });
  edge = await startLocalEdge({ port: Number(env("E2E_EDGE_PORT")),
    tls: { key: readFileSync(`${workdir}/key.pem`, "utf8"), cert: readFileSync(`${workdir}/cert.pem`, "utf8") },
    s3, bucket: env("E2E_S3_BUCKET"), databaseUrl: db.toString(), ticketKeys: { e2e: env("E2E_TICKET_SECRET") }, allowedOrigins: [appOrigin] });
});

test.afterAll(async () => {
  await edge?.close();
  if (role) scalar(`drop role if exists ${role}`);
});

const DESKTOP_ONLY = "storage behaviour, not layout: desktop only";

test("R2 photo: upload, edge retrieval, deletion", async ({ browser }, info) => {
  test.skip(ROLLBACK, "first run only");
  test.skip(info.project.name !== "chromium-desktop", DESKTOP_ONLY);
  const owner = await context(browser, info);
  const page = await owner.newPage();
  const appBytes: string[] = [];
  page.on("response", (r) => { if (r.url().startsWith(appOrigin) && /\/(api|p)\/media\//.test(new URL(r.url()).pathname)) appBytes.push(r.url()); });
  await signIn(page);
  const file = `${workdir}/work.jpg`;
  await photo(file, 40);
  const title = `E2E R2 photo ${randomBytes(3).toString("hex")}`;
  const card = await addWork(page, title, file);

  const key = scalar(`select object_key from public.portfolio_items where title = ${lit(title)}`);
  expect(scalar(`select provider || '|' || (verified_at is not null) || '|' || length(sha256) from public.media_storage_locations
    where namespace = 'portfolio' and object_key = ${lit(key)}`)).toBe("r2|true|64");
  const stored = await keys(`portfolio/${key}`);
  const variants = await keys(`v/portfolio/${key}/`);
  expect(stored).toEqual([`portfolio/${key}`]);
  expect(variants.length).toBeGreaterThan(0);

  const src = await card.locator("img").evaluate((img: HTMLImageElement) => img.currentSrc);
  expect(src.startsWith(`${edge.origin}/m/portfolio/`)).toBe(true);
  expect(src).toContain("?t=");
  expect(appBytes).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/r2-photo-manager.png` });

  // Deletion: refused at once, objects removed.
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("portfolio-manager").locator("li").filter({ hasText: title })).toHaveCount(0);
  expect(scalar(`select count(*) from public.portfolio_items where title = ${lit(title)}`)).toBe("0");
  await expect.poll(() => keys(`portfolio/${key}`)).toEqual([]);
  await expect(s3.send(new HeadObjectCommand({ Bucket: env("E2E_S3_BUCKET"), Key: `portfolio/${key}` }))).rejects.toBeTruthy();

  // Keep one R2 photo for the rollback run.
  if (scalar(`select count(*) from public.portfolio_items where title = ${lit(KEEP_TITLE)}`) === "0") {
    await photo(`${workdir}/keep.jpg`, 200);
    await addWork(page, KEEP_TITLE, `${workdir}/keep.jpg`);
  }
  await owner.close();
});

test("rollback: R2 off keeps R2 photos readable and sends new uploads to Supabase", async ({ browser }, info) => {
  test.skip(!ROLLBACK, "run with E2E_R2_ROLLBACK=1 (R2_STORAGE_ENABLED=false)");
  test.skip(info.project.name !== "chromium-desktop", DESKTOP_ONLY);
  const owner = await context(browser, info);
  const page = await owner.newPage();
  await signIn(page);
  await page.goto("/home/profile/portfolio");
  const kept = page.getByTestId("portfolio-manager").locator("li").filter({ hasText: KEEP_TITLE });
  await expect.poll(() => kept.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const keepKey = scalar(`select object_key from public.portfolio_items where title = ${lit(KEEP_TITLE)}`);
  expect(scalar(`select provider from public.media_storage_locations where namespace = 'portfolio' and object_key = ${lit(keepKey)}`)).toBe("r2");

  const file = `${workdir}/after.jpg`;
  await photo(file, 120);
  const title = `E2E after rollback ${randomBytes(3).toString("hex")}`;
  const card = await addWork(page, title, file);
  const key = scalar(`select object_key from public.portfolio_items where title = ${lit(title)}`);
  expect(scalar(`select provider from public.media_storage_locations where namespace = 'portfolio' and object_key = ${lit(key)}`)).toBe("supabase");
  expect(await keys(`portfolio/${key}`)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/r2-rollback-manager.png` });

  // Clean up both photos through the product.
  for (const t of [title, KEEP_TITLE]) {
    const c = page.getByTestId("portfolio-manager").locator("li").filter({ hasText: t });
    await c.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(c).toHaveCount(0);
  }
  void card;
  await owner.close();
});
