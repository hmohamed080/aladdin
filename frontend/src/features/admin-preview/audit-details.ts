/**
 * Phase 0D — turns an audit row's `metadata jsonb` into the labelled fields the
 * expandable details panel shows, so the default view never renders raw JSON.
 *
 * Pure and framework-free (unit-tested): the recognised keys are the ones the
 * existing audit RPCs actually write (`reason` / `decision_reason`, ids such as
 * `verification_id`, `referral_id`, before/after style pairs). Anything else is
 * kept as a plain `key: value` list rather than dropped — the panel must never
 * hide a recorded fact just because it has no dedicated slot.
 */

export type AuditDetails = {
  reason: string | null;
  referenceId: string | null;
  before: string | null;
  after: string | null;
  /** Everything else that was recorded, as label/value pairs. */
  rest: { key: string; value: string }[];
};

const REASON_KEYS = ["reason", "decision_reason", "reason_code"];
const REFERENCE_KEYS = ["reference_id", "referral_id", "verification_id", "request_id", "source_id", "entry_id"];
const BEFORE_KEYS = ["before", "old", "from", "previous", "old_role", "previous_role"];
const AFTER_KEYS = ["after", "new", "to", "current", "new_role"];

/** A scalar as text; a small object/array as `a: 1, b: 2` (never JSON braces); null/empty as null. */
export function humanizeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(humanizeValue).filter((v): v is string => v !== null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const text = humanizeValue(v);
        return text === null ? null : `${humanizeKey(k)}: ${text}`;
      })
      .filter((v): v is string => v !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

/** `decision_reason` → `Decision reason`. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function takeFirst(meta: Record<string, unknown>, keys: readonly string[], used: Set<string>): string | null {
  for (const k of keys) {
    if (k in meta) {
      const text = humanizeValue(meta[k]);
      used.add(k);
      if (text !== null) return text;
    }
  }
  return null;
}

export function describeAuditMetadata(metadata: unknown): AuditDetails {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const used = new Set<string>();
  const reason = takeFirst(meta, REASON_KEYS, used);
  const referenceId = takeFirst(meta, REFERENCE_KEYS, used);
  const before = takeFirst(meta, BEFORE_KEYS, used);
  const after = takeFirst(meta, AFTER_KEYS, used);
  const rest = Object.entries(meta)
    .filter(([k]) => !used.has(k))
    .flatMap(([k, v]) => {
      const value = humanizeValue(v);
      return value === null ? [] : [{ key: humanizeKey(k), value }];
    });
  return { reason, referenceId, before, after, rest };
}

/** A one-line summary for the collapsed row: the reason when there is one, else the first recorded fact. */
export function summarizeAuditDetails(details: AuditDetails, max = 80): string | null {
  const first = details.reason ?? (details.rest[0] ? `${details.rest[0].key}: ${details.rest[0].value}` : null) ?? details.referenceId;
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
