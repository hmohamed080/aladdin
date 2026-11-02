import { verifyBody } from "./signing";

/**
 * The Worker's alert callback (POST /api/internal/whatsapp-otp/notify). Authenticated ONLY by an HMAC with its own secret (never the send
 * secret or the admin secret); the body carries statistics and nothing else. The database re-validates every field again and writes through
 * the existing notification system (`app.notify`), once per event (a dedupe ledger), only to active staff who hold whatsapp_otp.view.
 *
 * Answers: 200 recorded or duplicate (the Worker marks the event delivered), 401 bad signature, 400 malformed, 503 not configured or the
 * database failed (the Worker keeps the event in its outbox and retries with backoff). A notification problem can never touch OTP delivery:
 * this route is downstream of it and the Worker's send path never waits for it.
 */
const MAX_BODY = 2048;
const KINDS = ["budget_warning", "budget_critical", "budget_exhausted", "failure_rate"] as const;
const KEYS = new Set(["event_key", "kind", "source_env", "occurred_at", "stats"]);

export type NotifyDeps = {
  secret: string | undefined;
  record: (a: { eventKey: string; kind: string; sourceEnv: string; occurredAt: number; stats: Record<string, number | string> }) => Promise<{ ok: boolean }>;
  now?: () => number;
};

const reply = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

export function parseNotifyBody(raw: string) {
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.has(k))) return null;
  const { event_key, kind, source_env, occurred_at, stats } = o;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return null;
  if (typeof event_key !== "string" || !new RegExp(`^${kind}:[0-9]{1,9}$`).test(event_key)) return null;
  if (typeof source_env !== "string" || !/^[a-z]{3,16}$/.test(source_env)) return null;
  if (typeof occurred_at !== "number" || !Number.isSafeInteger(occurred_at)) return null;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const clean: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
    if (!/^[a-z_]{1,24}$/.test(k)) return null;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) clean[k] = v;
    else if (typeof v === "string" && v.length <= 12 && /^[a-z]+$/.test(v)) clean[k] = v;
    else return null;
  }
  return { eventKey: event_key, kind, sourceEnv: source_env, occurredAt: occurred_at, stats: clean };
}

export async function handleNotify(request: Request, deps: NotifyDeps): Promise<Response> {
  if (request.method !== "POST") return reply(405);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply(415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return reply(413);
  if (!deps.secret) return reply(503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return reply(413);
  // Authenticate BEFORE parsing or touching any state.
  if (!verifyBody(deps.secret, raw, request.headers, deps.now?.() ?? Date.now())) return reply(401);
  const parsed = parseNotifyBody(raw);
  if (!parsed) return reply(400);
  // The signed id must BE this event's identity (the Worker signs `ntf_<event_key>`), so one signature cannot be re-labelled as another event.
  if (request.headers.get("webhook-id") !== `ntf_${parsed.eventKey.replace(/[^A-Za-z0-9_:-]/g, "")}`) return reply(400);
  try {
    const result = await deps.record(parsed);
    return reply(result.ok ? 200 : 503);
  } catch {
    return reply(503);
  }
}
