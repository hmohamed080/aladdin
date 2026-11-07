#!/usr/bin/env node
/**
 * Least-privilege probe for one environment's R2 credentials. NOT run by CI or the app: the
 * owner (or a separately approved Acceptance step) runs it with that environment's credentials.
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   node scripts/check-r2-credential-scope.mjs --allowed <bucket> --forbidden <bucket> [--forbidden <bucket>...]
 *
 * PASS requires: write/read/delete of a throwaway object under `_scope-probe/` in the allowed bucket,
 * and AccessDenied (never success) for EVERY forbidden bucket (the other environment's media, site
 * and backup buckets). A credential that can reach a forbidden bucket is too broad: rotate it.
 * Secrets are read from the environment only and never printed.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

export async function checkScope(client, { allowed, forbidden }) {
  const problems = [];
  const key = `_scope-probe/${randomUUID()}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: allowed, Key: key, Body: "probe" }));
    await client.send(new GetObjectCommand({ Bucket: allowed, Key: key }));
    await client.send(new DeleteObjectCommand({ Bucket: allowed, Key: key }));
  } catch {
    problems.push("credentials cannot write, read and delete in the allowed bucket");
  }
  for (const bucket of forbidden) {
    for (const [name, command] of [
      ["list", new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })],
      ["write", new PutObjectCommand({ Bucket: bucket, Key: `_scope-probe/${randomUUID()}`, Body: "probe" })],
    ]) {
      try {
        await client.send(command);
        problems.push(`credentials can ${name} in a forbidden bucket (index ${forbidden.indexOf(bucket)})`);
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        if (status !== 403 && error?.name !== "AccessDenied") problems.push(`forbidden bucket ${forbidden.indexOf(bucket)}: expected AccessDenied, got ${error?.name ?? "error"}`);
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  const [allowed] = take("--allowed");
  const forbidden = take("--forbidden");
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!allowed || forbidden.length === 0 || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error("usage: needs --allowed, at least one --forbidden and R2_* credentials in the environment");
    process.exit(2);
  }
  const client = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
  const problems = await checkScope(client, { allowed, forbidden });
  for (const p of problems) console.error(`FAIL: ${p}`);
  console.log(problems.length === 0 ? "PASS: credentials are scoped to the allowed bucket" : `${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
