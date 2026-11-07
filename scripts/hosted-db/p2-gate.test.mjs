import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkPending, checkSnapshot, EXPECT_PENDING, PRODUCTION_REF } from "./p2-gate.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const NOW = Date.parse("2026-11-07T20:00:00Z");
const files = { "roles.sql": Buffer.from("r"), "schema.sql": Buffer.from("s"), "data.sql": Buffer.from("d"), "security-tail.out.sql": Buffer.from("t") };
const enc = Buffer.from("encrypted-bytes");
const meta = (o = {}) => Object.entries({ taken_utc: "2026-11-07T19:30:00Z", project: PRODUCTION_REF, history_count: 195, history_latest: "20261107090002", row_counts_validated: "copy-vs-select", ...o }).map(([k, v]) => `${k}=${v}`).join("\n");
const base = (o = {}) => ({
  meta: meta(), sums: Object.entries(files).map(([n, b]) => `${sha(b)}  ${n}`).join("\n"), readBackup: (f) => files[f],
  encSha: `${sha(enc)}  x.tar.gpg`, encryptedBytes: enc,
  verified: `verified_utc=2026-11-07T19:35:00Z\nencrypted_sha256=${sha(enc)}\nsnapshot_taken_utc=2026-11-07T19:30:00Z\nsnapshot_project=${PRODUCTION_REF}`,
  now: NOW, ...o,
});
const has = (problems, re) => assert.ok(problems.some((x) => re.test(x)), `expected a problem matching ${re}, got ${JSON.stringify(problems)}`);

test("a fresh, verified snapshot of Production passes", () => assert.deepEqual(checkSnapshot(base()), []));
test("a snapshot older than 60 minutes is refused, 60 exactly is accepted", () => {
  has(checkSnapshot(base({ now: NOW + 31 * 60000 })), /minutes old/);
  assert.deepEqual(checkSnapshot(base({ now: NOW + 30 * 60000 })), []);
});
test("a future timestamp is refused", () => has(checkSnapshot(base({ now: NOW - 3600000 })), /future/));
test("a snapshot of another project is refused", () => has(checkSnapshot(base({ meta: meta({ project: "nxossqhdfltcqdwvbewi" }) })), /expected Production/));
test("wrong history count or latest version is refused", () => {
  has(checkSnapshot(base({ meta: meta({ history_count: 193 }) })), /history_count/);
  has(checkSnapshot(base({ meta: meta({ history_latest: "20261027090001" }) })), /history_latest/);
});
test("a snapshot whose row counts were not validated is refused", () => has(checkSnapshot(base({ meta: meta({ row_counts_validated: "no" }) })), /COPY vs SELECT/));
test("a backup file changed after its checksum is refused", () => has(checkSnapshot(base({ readBackup: (f) => (f === "data.sql" ? Buffer.from("tampered") : files[f]) })), /data\.sql no longer matches/));
test("a missing encrypted backup is refused", () => has(checkSnapshot(base({ encryptedBytes: null })), /encrypted backup .* missing/));
test("an encrypted backup without a passed recovery check is refused", () => has(checkSnapshot(base({ verified: null })), /recovery check has not passed/));
test("an encrypted backup changed after its recovery check is refused", () => {
  has(checkSnapshot(base({ encryptedBytes: Buffer.from("other"), encSha: `${sha(Buffer.from("other"))}  y` })), /changed after its recovery check/);
  has(checkSnapshot(base({ encSha: `${"0".repeat(64)}  x` })), /does not match its \.sha256/);
});
test("a recovery check from another snapshot is refused", () => {
  const v = `verified_utc=2026-11-07T19:35:00Z\nencrypted_sha256=${sha(enc)}\nsnapshot_taken_utc=2026-11-07T10:00:00Z\nsnapshot_project=${PRODUCTION_REF}`;
  has(checkSnapshot(base({ verified: v })), /different snapshot/);
});

const list = (o = {}) => ({
  migrations: [
    ...Array.from({ length: 194 }, (_, i) => ({ local: `2025${String(1000 + i)}000000`, remote: `2025${String(1000 + i)}000000` })),
    { local: "20261107090002", remote: "20261107090002" },
    ...EXPECT_PENDING.map((v) => ({ local: v, remote: null })),
  ].concat(o.extra ?? []),
});
const dry = (v = EXPECT_PENDING) => ({ dryRun: true, migrations: v.map((x) => `${x}_x.sql`) });
const local = [...EXPECT_PENDING];

test("exactly the expected 8 pending migrations pass", () => assert.deepEqual(checkPending({ list: list(), dry: dry(), localVersions: local }), []));
test("a ninth pending migration is refused", () => {
  const out = checkPending({ list: list({ extra: [{ local: "20261108090001", remote: null }] }), dry: dry([...EXPECT_PENDING, "20261108090001"]), localVersions: local });
  has(out, /pending migrations are/); has(out, /dry run would push/);
});
test("a missing pending migration is refused", () => has(checkPending({ list: list(), dry: dry(EXPECT_PENDING.slice(1)), localVersions: local }), /dry run would push/));
test("a remote-only migration or changed applied count is refused", () => {
  const l = list(); l.migrations.push({ local: null, remote: "20261201000000" });
  has(checkPending({ list: l, dry: dry(), localVersions: local }), /lacks/);
  has(checkPending({ list: l, dry: dry(), localVersions: local }), /196 applied/);
});
test("a dry run that is not a dry run is refused", () => has(checkPending({ list: list(), dry: { ...dry(), dryRun: false }, localVersions: local }), /dryRun:true/));
test("a missing local migration file is refused", () => has(checkPending({ list: list(), dry: dry(), localVersions: local.slice(1) }), /not in this checkout/));
