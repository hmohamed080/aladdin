"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatCount } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";
import { Card, InlineError, InlineSuccess, ProgressMeter } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { UploadIcon } from "@/components/ui/icons";
import { readSpreadsheet, type SheetGrid } from "@/lib/marketplace-import/spreadsheet";
import { listZipEntries, readZipEntry } from "@/lib/marketplace-import/zip";
import {
  TARGET_FIELDS,
  attributeColumns,
  buildPlan,
  chunk,
  matchImages,
  type FieldSource,
  type ImageMatch,
  type ImportConfig,
  type TargetField,
} from "@/lib/marketplace-import/plan";
import { MARKETPLACE_IMAGE_BUCKET, parseSellerError } from "./errors";

export type RecentJob = {
  id: string;
  mode: "dry_run" | "apply";
  status: string;
  source_file_name: string;
  total_rows: number;
  total_assets: number;
  valid_rows: number;
  invalid_rows: number;
  applied_rows: number;
  failed_rows: number;
  created_at: string;
};

type ReportRow = { row_number: number | null; external_ref: string | null; sku: string | null; file_name: string | null; severity: string; code: string; field: string | null; message: string };

/** One image the run can upload: a picked file or an entry inside a picked ZIP. */
type ImageSource = { fileName: string; size: number; read: () => Promise<Blob> };

const SELLING_UNITS = ["piece", "roll", "board", "bar", "linear_meter", "square_meter", "pack"] as const;
const OPEN_STATUSES = new Set(["created", "staging", "staged", "validating", "validated", "applying"]);
const MIME: Record<ImageMatch["extension"], string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Header names (Arabic or English) a typical export uses, for the first guess of the mapping. */
const GUESS: Partial<Record<TargetField, RegExp>> = {
  code: /^(الكود|كود|code|sku|item ?code)$/i,
  price: /^(السعر|سعر|price|price ?egp)$/i,
  quantity: /^(المخزون|المخزون الكلي|الكمية|qty|quantity|stock)$/i,
  name_ar: /^(الاسم|اسم المنتج|name ?ar|arabic name)$/i,
  name_en: /^(name|name ?en|english name|product name)$/i,
  brand: /^(الماركة|العلامة التجارية|brand)$/i,
};

function guessConfig(header: string[], types: { key: string }[]): ImportConfig {
  const fields = Object.fromEntries(TARGET_FIELDS.map((f) => [f, { kind: "none" } as FieldSource])) as Record<TargetField, FieldSource>;
  header.forEach((h, i) => {
    for (const f of TARGET_FIELDS) {
      if (fields[f].kind === "none" && GUESS[f]?.test(h.trim())) fields[f] = { kind: "column", column: i };
    }
  });
  if (fields.product_type.kind === "none" && types[0]) fields.product_type = { kind: "constant", value: types[0].key };
  if (fields.selling_unit.kind === "none") fields.selling_unit = { kind: "constant", value: "piece" };
  return { headerRow: 0, groupBySuffix: true, fields };
}

export function ImportWizard({
  organizationId,
  types,
  recentJobs,
}: {
  organizationId: string;
  types: { key: string; name: string }[];
  recentJobs: RecentJob[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const tx = (k: string, vars?: Record<string, string | number>) => t(`marketplaceSeller.imports.${k}`, vars);

  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; format: "csv" | "xlsx" } | null>(null);
  const [grid, setGrid] = useState<SheetGrid | null>(null);
  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [images, setImages] = useState<ImageSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ job: RecentJob; report: ReportRow[]; publish?: Record<string, unknown> } | null>(null);
  const cancelled = useRef(false);

  const header = grid?.[config?.headerRow ?? 0] ?? [];
  const plan = useMemo(() => (grid && config ? buildPlan(grid, config) : null), [grid, config]);
  const matches = useMemo(
    () => (plan ? matchImages(images.map((i) => ({ fileName: i.fileName, size: i.size })), plan.rows) : null),
    [images, plan],
  );

  function errorText(e: unknown): string {
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
    if (/too many active imports/i.test(message)) return tx("errors.too_many_jobs");
    if (/idempotency key already used/i.test(message)) return tx("errors.idempotency_conflict");
    if (/only be staged while/i.test(message)) return tx("errors.already_staged");
    const code = parseSellerError(message).code;
    return code === "unexpected" ? tx("errors.unexpected") : tx(`errors.${code}`) === `marketplaceSeller.imports.errors.${code}` ? `${tx("errors.unexpected")} (${code})` : tx(`errors.${code}`);
  }

  async function onSpreadsheet(f: File) {
    setError(null);
    setResult(null);
    const lower = f.name.toLowerCase();
    const format = lower.endsWith(".csv") ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : null;
    if (!format) return setError(tx("errors.format"));
    if (f.size > 20 * 1024 * 1024) return setError(tx("errors.too_big"));
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const g = await readSpreadsheet(f.name, bytes);
      if (g.length < 2) return setError(tx("errors.empty"));
      setFile({ name: f.name, bytes, format });
      setGrid(g);
      setConfig(guessConfig(g[0] ?? [], types));
    } catch {
      setError(tx("errors.unreadable"));
    }
  }

  async function onImages(list: FileList) {
    setError(null);
    const next: ImageSource[] = [];
    for (const f of Array.from(list)) {
      if (f.name.toLowerCase().endsWith(".zip")) {
        try {
          const data = new Uint8Array(await f.arrayBuffer());
          for (const entry of listZipEntries(data)) {
            if (entry.name.endsWith("/") || entry.name.split("/").pop()?.startsWith(".")) continue;
            next.push({
              fileName: entry.name,
              size: entry.uncompressedSize,
              read: async () => new Blob([(await readZipEntry(data, entry)) as Uint8Array<ArrayBuffer>]),
            });
          }
        } catch {
          setError(tx("errors.zip"));
        }
      } else {
        next.push({ fileName: f.name, size: f.size, read: async () => f });
      }
    }
    setImages((cur) => {
      const seen = new Set(cur.map((c) => c.fileName));
      return [...cur, ...next.filter((n) => !seen.has(n.fileName))];
    });
  }

  function setField(field: TargetField, source: FieldSource) {
    setConfig((c) => (c ? { ...c, fields: { ...c.fields, [field]: source } } : c));
  }

  /** Runs the database steps of a job until it settles (resumable: every step is idempotent). */
  async function drive(jobId: string, mode: "dry_run" | "apply") {
    const supabase = createBrowserSupabaseClient();
    const step = async (name: string, payload?: unknown) => {
      const { data, error: e } = await supabase.rpc("marketplace_seller_import_step", {
        p_job: jobId,
        p_step: name,
        p_payload: (payload ?? null) as never,
      });
      if (e) throw e;
      return (data ?? {}) as Record<string, unknown>;
    };
    const job = async () => {
      const { data } = await supabase.from("marketplace_import_jobs").select("*").eq("id", jobId).single();
      return data as unknown as RecentJob;
    };

    let j = await job();
    if (j.status === "created" || j.status === "staging") {
      setProgress({ phase: tx("phase.seal"), done: 0, total: 1 });
      await step("seal");
      j = await job();
    }
    while (["staged", "validating"].includes(j.status) && !cancelled.current) {
      const r = await step("validate");
      j = await job();
      setProgress({ phase: tx("phase.validate"), done: j.total_rows - Number(r.remaining ?? 0), total: j.total_rows });
    }
    if (mode === "dry_run" && j.status === "validated") {
      await step("complete_dry_run");
    }
    while (mode === "apply" && ["validated", "applying"].includes(j.status) && !cancelled.current) {
      const r = await step("apply");
      j = await job();
      setProgress({ phase: tx("phase.apply"), done: j.valid_rows - Number(r.remaining ?? 0), total: j.valid_rows });
    }
    j = await job();
    const { data: report } = await supabase.rpc("marketplace_import_job_report", { p_job: jobId });
    setResult({ job: j, report: (report ?? []) as ReportRow[] });
    router.refresh();
  }

  async function run(mode: "dry_run" | "apply") {
    if (!file || !config || !plan || !plan.rows.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    cancelled.current = false;
    try {
      const supabase = createBrowserSupabaseClient();
      const checksum = await sha256Hex(file.bytes as Uint8Array<ArrayBuffer>);
      const configHash = (await sha256Hex(JSON.stringify(config))).slice(0, 16);
      const imageHash = mode === "apply" && matches ? (await sha256Hex(matches.matched.map((m) => `${m.fileName}>${m.registeredName}`).join("\n"))).slice(0, 12) : "none";
      const { data: jobId, error: createError } = await supabase.rpc("marketplace_import_job_create", {
        p_organization_id: organizationId,
        p_format: file.format,
        p_file_name: file.name.slice(0, 255),
        p_checksum: checksum,
        p_mode: mode,
        p_chunk_size: 500,
        p_idempotency_key: `${mode}-${checksum.slice(0, 32)}-${configHash}-${imageHash}`,
      });
      if (createError || !jobId) throw createError ?? new Error("mp:unexpected");
      const { data: j } = await supabase.from("marketplace_import_jobs").select("status").eq("id", jobId).single();

      if (j && (j.status === "created" || j.status === "staging")) {
        // 1) images (apply only) — uploaded to this job's own prefix, deterministic names, resumable
        const toUpload = mode === "apply" && matches ? matches.matched : [];
        const assets: Record<string, unknown>[] = [];
        let done = 0;
        for (const group of chunk(toUpload, 4)) {
          if (cancelled.current) throw new Error("mp:cancelled");
          await Promise.all(
            group.map(async (m) => {
              const index = toUpload.indexOf(m);
              const objectKey = `imports/${organizationId}/${jobId}/${String(index + 1).padStart(5, "0")}.${m.extension}`;
              const source = images.find((i) => i.fileName === m.fileName)!;
              const blob = await source.read();
              const { error: upError } = await supabase.storage
                .from(MARKETPLACE_IMAGE_BUCKET)
                .upload(objectKey, blob, { contentType: MIME[m.extension], upsert: false, cacheControl: "300" });
              // an object that already exists is a resumed upload, not a failure
              if (upError && !/exists|duplicate/i.test(upError.message)) throw upError;
              assets.push({ file_name: m.registeredName, storage_bucket: MARKETPLACE_IMAGE_BUCKET, object_key: objectKey, mime_type: MIME[m.extension] });
            }),
          );
          done += group.length;
          setProgress({ phase: tx("phase.upload"), done, total: toUpload.length });
        }
        // 2) rows, then assets (both idempotent on replay)
        const rowChunks = chunk(plan.rows, 1000);
        for (const [i, rows] of rowChunks.entries()) {
          setProgress({ phase: tx("phase.stage"), done: i, total: rowChunks.length });
          const { error: e } = await supabase.rpc("marketplace_seller_import_step", { p_job: jobId, p_step: "stage_rows", p_payload: rows as never });
          if (e) throw e;
        }
        for (const part of chunk(assets.sort((a, b) => String(a.file_name).localeCompare(String(b.file_name))), 500)) {
          const { error: e } = await supabase.rpc("marketplace_seller_import_step", { p_job: jobId, p_step: "stage_assets", p_payload: part as never });
          if (e) throw e;
        }
      }
      await drive(jobId, mode);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function act(job: RecentJob, action: "resume" | "retry" | "cancel" | "report") {
    setBusy(true);
    setError(null);
    cancelled.current = false;
    const supabase = createBrowserSupabaseClient();
    try {
      if (action === "cancel") {
        const { error: e } = await supabase.rpc("marketplace_import_job_cancel", { p_job: job.id });
        if (e) throw e;
        router.refresh();
      } else if (action === "report") {
        const { data: report } = await supabase.rpc("marketplace_import_job_report", { p_job: job.id });
        setResult({ job, report: (report ?? []) as ReportRow[] });
      } else {
        if (job.status === "created" || job.status === "staging") throw new Error("mp:reselect_file");
        if (action === "retry") {
          const { error: e } = await supabase.rpc("marketplace_seller_import_step", { p_job: job.id, p_step: "retry_failed" });
          if (e) throw e;
        }
        await drive(job.id, job.mode);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function publishReady() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error: e } = await supabase.rpc("marketplace_seller_publish_ready", { p_organization_id: organizationId, p_limit: 1000 });
      if (e) throw e;
      setResult((r) => (r ? { ...r, publish: data as Record<string, unknown> } : r));
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadReport(rows: ReportRow[]) {
    const head = ["row_number", "external_ref", "sku", "file_name", "severity", "code", "field", "message"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [head.join(","), ...rows.map((r) => head.map((h) => esc(r[h as keyof ReportRow])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const n = (v: number) => formatCount(v, locale);
  const columnOptions = header.map((h, i) => ({ value: String(i), label: `${i} · ${h || "—"}` }));

  return (
    <div className="flex flex-col gap-md">
      {/* 1. spreadsheet */}
      <Card className="flex flex-col gap-sm">
        <h2 className="text-body-lg font-semibold text-fg">{tx("step1")}</h2>
        <p className="text-label text-fg-secondary">{tx("step1Hint")}</p>
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-sm border border-strong px-md py-2 text-label font-medium hover:bg-surface-2">
          <UploadIcon size={16} />
          {file ? file.name : tx("chooseFile")}
          <input
            type="file"
            accept=".xlsx,.csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onSpreadsheet(f);
              e.target.value = "";
            }}
          />
        </label>
        {grid ? <p className="text-label text-fg-muted">{tx("parsed", { rows: n(grid.length - 1), cols: n(header.length) })}</p> : null}
      </Card>

      {/* 2. mapping */}
      {config && grid ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body-lg font-semibold text-fg">{tx("step2")}</h2>
          <p className="text-label text-fg-secondary">{tx("step2Hint")}</p>
          <div className="grid gap-sm tablet:grid-cols-2">
            {TARGET_FIELDS.map((field) => {
              const src = config.fields[field];
              const id = `map-${field}`;
              const choices = field === "product_type" ? types.map((x) => ({ value: x.key, label: x.name })) : field === "selling_unit" ? SELLING_UNITS.map((u) => ({ value: u, label: t(`marketplaceSeller.unit.${u}`) })) : null;
              return (
                <LabeledField key={field} label={tx(`field.${field}`)} htmlFor={id}>
                  <div className="flex gap-2">
                    <div className="w-36 shrink-0">
                      <Select
                        id={id}
                        size="compact"
                        value={src.kind}
                        onChange={(e) => {
                          const kind = e.target.value as FieldSource["kind"];
                          setField(
                            field,
                            kind === "column" ? { kind, column: 0 } : kind === "constant" ? { kind, value: choices?.[0]?.value ?? "" } : kind === "template" ? { kind, template: "" } : { kind: "none" },
                          );
                        }}
                      >
                        <option value="none">{tx("source.none")}</option>
                        <option value="column">{tx("source.column")}</option>
                        <option value="constant">{tx("source.constant")}</option>
                        {choices ? null : <option value="template">{tx("source.template")}</option>}
                      </Select>
                    </div>
                    <div className="min-w-0 flex-1">
                      {src.kind === "column" ? (
                        <Select size="compact" aria-label={tx(`field.${field}`)} value={String(src.column)} onChange={(e) => setField(field, { kind: "column", column: Number(e.target.value) })}>
                          {columnOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      ) : src.kind === "constant" && choices ? (
                        <Select size="compact" aria-label={tx(`field.${field}`)} value={src.value} onChange={(e) => setField(field, { kind: "constant", value: e.target.value })}>
                          {choices.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      ) : src.kind === "constant" ? (
                        <Input aria-label={tx(`field.${field}`)} value={src.value} maxLength={200} onChange={(e) => setField(field, { kind: "constant", value: e.target.value })} />
                      ) : src.kind === "template" ? (
                        <Input aria-label={tx(`field.${field}`)} value={src.template} maxLength={200} placeholder="{0} {2}" dir="auto" onChange={(e) => setField(field, { kind: "template", template: e.target.value })} />
                      ) : null}
                    </div>
                  </div>
                </LabeledField>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-body text-fg">
            <input type="checkbox" checked={config.groupBySuffix} onChange={(e) => setConfig({ ...config, groupBySuffix: e.target.checked })} className="h-4.5 w-4.5 accent-[var(--accent-solid)]" />
            {tx("groupBySuffix")}
          </label>
          <p className="text-label text-fg-muted">{tx("templateHint")}</p>
          <LabeledField label={tx("fixedAttributes")} htmlFor="fixed-attributes" hint={tx("fixedAttributesHint")}>
            <Textarea
              id="fixed-attributes"
              rows={3}
              dir="ltr"
              className="font-mono"
              placeholder="material_wallpaper=non_woven"
              value={config.fixedAttributes ?? ""}
              maxLength={2000}
              onChange={(e) => setConfig({ ...config, fixedAttributes: e.target.value })}
            />
          </LabeledField>
          <p className="text-label text-fg-secondary">
            {tx("attrColumns", { count: n(attributeColumns(header).size) })}
            {attributeColumns(header).size ? ` — ${[...attributeColumns(header).keys()].join(", ")}` : ""}
          </p>
        </Card>
      ) : null}

      {/* 3. preview */}
      {plan ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body-lg font-semibold text-fg">{tx("step3")}</h2>
          <div className="grid grid-cols-2 gap-sm tablet:grid-cols-4">
            {[
              [tx("count.products"), plan.products],
              [tx("count.variantRows"), plan.variantRows],
              [tx("count.singles"), plan.singleVariantProducts],
              [tx("count.rejected"), plan.rejected.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-sm border px-sm py-2">
                <p className="text-label text-fg-muted">{label}</p>
                <p className="text-headline font-semibold tabular-nums text-fg">{n(Number(value))}</p>
              </div>
            ))}
          </div>
          {plan.rejected.length ? (
            <details className="text-label">
              <summary className="cursor-pointer font-medium text-danger">{tx("rejectedList", { count: n(plan.rejected.length) })}</summary>
              <ul className="mt-1 max-h-48 overflow-auto">
                {plan.rejected.map((r) => (
                  <li key={`${r.row_number}-${r.code}`} className="text-fg-secondary">
                    {tx("rowN", { row: n(r.row_number) })}: {tx(`local.${r.code}`)} <span dir="ltr">{r.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {plan.warnings.some((w) => w.code !== "sku_normalized") ? (
            <p className="text-label text-warning">{tx("missingFields")}</p>
          ) : null}
          {plan.warnings.some((w) => w.code === "sku_normalized") ? (
            <p className="text-label text-fg-secondary">{tx("skuNormalized", { count: n(plan.warnings.filter((w) => w.code === "sku_normalized").length) })}</p>
          ) : null}
          <div className="overflow-x-auto rounded-sm border">
            <table className="w-full min-w-[48rem] text-label">
              <thead className="bg-surface-2/50 text-fg-secondary">
                <tr>
                  {["row", "sku", "ref", "name_ar", "price", "quantity"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-start font-medium">
                      {tx(`col.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 15).map((r) => (
                  <tr key={r.row_number} className="border-t">
                    <td className="px-2 py-1 tabular-nums">{n(r.row_number)}</td>
                    <td className="px-2 py-1 font-mono" dir="ltr">{r.sku}</td>
                    <td className="px-2 py-1 font-mono" dir="ltr">{r.external_ref}</td>
                    <td className="px-2 py-1">{r.name_ar || "—"}</td>
                    <td className="px-2 py-1 tabular-nums">{r.price}</td>
                    <td className="px-2 py-1 tabular-nums">{r.quantity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* 4. images */}
      {plan ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body-lg font-semibold text-fg">{tx("step4")}</h2>
          <p className="text-label text-fg-secondary">{tx("step4Hint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-sm border border-strong px-md py-2 text-label font-medium hover:bg-surface-2">
              <UploadIcon size={16} />
              {tx("chooseImages")}
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.zip"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files?.length) void onImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {images.length ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setImages([])}>
                {tx("clearImages")}
              </Button>
            ) : null}
          </div>
          {matches && images.length ? (
            <div className="flex flex-col gap-1 text-label">
              <p className="text-fg">
                {tx("imagesSummary", {
                  total: n(images.length),
                  matched: n(matches.matched.length),
                  unmatched: n(matches.unmatched.length + matches.unsupported.length + matches.tooLarge.length),
                })}
              </p>
              <p className="text-fg-muted">
                {tx("imagesCoverage", {
                  products: n(new Set(matches.matched.map((m) => m.externalRef)).size),
                  of: n(plan.products),
                })}
              </p>
              {matches.unmatched.length + matches.unsupported.length + matches.tooLarge.length ? (
                <details>
                  <summary className="cursor-pointer text-warning">{tx("unmatchedList")}</summary>
                  <ul className="max-h-40 overflow-auto font-mono" dir="ltr">
                    {[...matches.unmatched, ...matches.unsupported, ...matches.tooLarge].map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="text-label text-warning">{tx("noImages")}</p>
          )}
        </Card>
      ) : null}

      {/* 5. run */}
      {plan ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body-lg font-semibold text-fg">{tx("step5")}</h2>
          <p className="text-label text-fg-secondary">{tx("step5Hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !plan.rows.length} onClick={() => void run("dry_run")}>
              {tx("dryRun")}
            </Button>
            <Button variant="accent" disabled={busy || !plan.rows.length} onClick={() => void run("apply")}>
              {tx("importDrafts", { count: n(plan.rows.length) })}
            </Button>
            {busy ? (
              <Button variant="ghost" onClick={() => (cancelled.current = true)}>
                {tx("stop")}
              </Button>
            ) : null}
          </div>
          {progress ? (
            <div className="flex flex-col gap-1">
              <p className="text-label text-fg-secondary">
                {progress.phase} — {n(progress.done)} / {n(progress.total)}
              </p>
              <ProgressMeter value={progress.total ? (progress.done / progress.total) * 100 : 0} label={progress.phase} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {error ? <InlineError>{error}</InlineError> : null}

      {result ? <JobResult result={result} tx={tx} n={n} busy={busy} onDownload={downloadReport} onPublish={publishReady} /> : null}

      {/* recent jobs */}
      {recentJobs.length ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body-lg font-semibold text-fg">{tx("recent")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-label">
              <thead className="text-fg-secondary">
                <tr>
                  {["file", "mode", "status", "rows", "valid", "invalid", "applied", "failed", "actions"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-start font-medium">
                      {tx(`jobCol.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="max-w-[14rem] truncate px-2 py-1.5">{j.source_file_name}</td>
                    <td className="px-2 py-1.5">{tx(`mode.${j.mode}`)}</td>
                    <td className="px-2 py-1.5">{tx(`status.${j.status}`)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{n(j.total_rows)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{n(j.valid_rows)}</td>
                    <td className={cn("px-2 py-1.5 tabular-nums", j.invalid_rows ? "text-danger" : undefined)}>{n(j.invalid_rows)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{n(j.applied_rows)}</td>
                    <td className={cn("px-2 py-1.5 tabular-nums", j.failed_rows ? "text-danger" : undefined)}>{n(j.failed_rows)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(j, "report")}>
                          {tx("action.report")}
                        </Button>
                        {OPEN_STATUSES.has(j.status) ? (
                          <>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(j, "resume")}>
                              {tx("action.resume")}
                            </Button>
                            <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(j, "cancel")}>
                              {tx("action.cancel")}
                            </Button>
                          </>
                        ) : null}
                        {j.mode === "apply" && j.status === "completed_with_errors" && j.failed_rows > 0 ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(j, "retry")}>
                            {tx("action.retry")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function JobResult({
  result,
  tx,
  n,
  busy,
  onDownload,
  onPublish,
}: {
  result: { job: RecentJob; report: ReportRow[]; publish?: Record<string, unknown> };
  tx: (k: string, vars?: Record<string, string | number>) => string;
  n: (v: number) => string;
  busy: boolean;
  onDownload: (rows: ReportRow[]) => void;
  onPublish: () => void;
}) {
  const { job, report, publish } = result;
  const byCode = new Map<string, { severity: string; count: number }>();
  for (const r of report) {
    const cur = byCode.get(r.code) ?? { severity: r.severity, count: 0 };
    cur.count += 1;
    byCode.set(r.code, cur);
  }
  return (
    <Card className="flex flex-col gap-sm">
      <h2 className="text-body-lg font-semibold text-fg">
        {tx("resultTitle")} — {tx(`mode.${job.mode}`)} · {tx(`status.${job.status}`)}
      </h2>
      <div className="grid grid-cols-2 gap-sm tablet:grid-cols-5">
        {[
          [tx("jobCol.rows"), job.total_rows],
          [tx("jobCol.valid"), job.valid_rows],
          [tx("jobCol.invalid"), job.invalid_rows],
          [tx("jobCol.applied"), job.applied_rows],
          [tx("jobCol.failed"), job.failed_rows],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-sm border px-sm py-2">
            <p className="text-label text-fg-muted">{label}</p>
            <p className="text-headline font-semibold tabular-nums text-fg">{n(Number(value))}</p>
          </div>
        ))}
      </div>
      {job.mode === "apply" && job.applied_rows > 0 ? <InlineSuccess>{tx("draftsNote")}</InlineSuccess> : null}
      {byCode.size ? (
        <ul className="flex flex-col gap-0.5 text-label">
          {[...byCode].map(([code, v]) => (
            <li key={code} className={v.severity === "error" ? "text-danger" : "text-warning"}>
              {n(v.count)} × {code}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {report.length ? (
          <Button size="sm" variant="outline" onClick={() => onDownload(report)}>
            {tx("downloadReport")}
          </Button>
        ) : null}
        {job.mode === "apply" && job.applied_rows > 0 ? (
          <Button size="sm" disabled={busy} onClick={onPublish}>
            {tx("publishReady")}
          </Button>
        ) : null}
      </div>
      {publish ? (
        <div className="flex flex-col gap-0.5 text-label">
          <p className="font-medium text-fg">
            {tx("publishResult", { published: n(Number(publish.published ?? 0)), checked: n(Number(publish.checked ?? 0)) })}
          </p>
          {Object.entries((publish.blocked_by_reason ?? {}) as Record<string, number>).map(([k, v]) => (
            <p key={k} className="text-warning">
              {n(Number(v))} × {k}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
