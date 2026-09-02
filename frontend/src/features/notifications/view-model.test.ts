import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import {
  KNOWN_NOTIFICATION_EVENTS,
  NOTIFICATION_FALLBACK_TITLE_KEY,
  toNotificationView,
  toNotificationViews,
  type NotificationSource,
} from "./view-model";

const NOW = new Date("2026-08-22T12:00:00Z");

function row(over: Partial<NotificationSource> = {}): NotificationSource {
  return {
    id: "n1",
    event_type: "quotation.submitted",
    deep_link: "/b2b/quotations/abc",
    title_key: "notifications.quotation.submitted.title",
    body_key: "notifications.quotation.submitted.body",
    params: { supplier_name: "Nile Ceramics", total: 48500 },
    read_at: null,
    created_at: "2026-08-22T09:00:00Z",
    organization_id: "org-1",
    ...over,
  };
}

const enT = createTranslator("en");
const arT = createTranslator("ar");

describe("the persisted key contract is honoured exactly", () => {
  it("renders English copy from the stored keys and params", () => {
    const view = toNotificationView(row(), enT, "en", NOW);
    expect(view.title).toBe(en.notifications.quotation.submitted.title);
    expect(view.body).toContain("Nile Ceramics");
    expect(view.degraded).toBe(false);
  });

  it("renders Arabic copy for the same row — the row itself holds no language", () => {
    const view = toNotificationView(row(), arT, "ar", NOW);
    expect(view.title).toBe(ar.notifications.quotation.submitted.title);
    // Real Arabic prose, not an English string that happened to survive.
    expect(view.title).toMatch(/[؀-ۿ]/);
    expect(view.body).toMatch(/[؀-ۿ]/);
    expect(view.body).toContain("Nile Ceramics"); // an org's own name is not translated
  });

  it("formats a money param as money, and a count as a localized quantity", () => {
    const en48 = toNotificationView(row(), enT, "en", NOW);
    expect(en48.body).toContain("EGP");

    const counted = row({
      event_type: "rfq.submitted",
      title_key: "notifications.rfq.submitted.title",
      body_key: "notifications.rfq.submitted.body",
      params: { requester_name: "Delta Contracting", item_count: 12 },
    });
    // A quantity follows the reader's numerals; Arabic gets Arabic-Indic digits.
    expect(toNotificationView(counted, enT, "en", NOW).body).toContain("12");
    expect(toNotificationView(counted, arT, "ar", NOW).body).toContain("١٢");
  });

  it("carries the STORED deep link through untouched", () => {
    const view = toNotificationView(row({ deep_link: "/b2b/orders/xyz" }), enT, "en", NOW);
    // Never rebuilt from event_type + subject_id: the destination reflects where
    // the record lived when the event happened.
    expect(view.href).toBe("/b2b/orders/xyz");
  });

  it("reads unread from `read_at is null`", () => {
    expect(toNotificationView(row({ read_at: null }), enT, "en", NOW).unread).toBe(true);
    expect(
      toNotificationView(row({ read_at: "2026-08-22T10:00:00Z" }), enT, "en", NOW).unread,
    ).toBe(false);
  });
});

describe("every approved event type has real bilingual copy", () => {
  it("covers all sixteen, in both locales, with no key leaking through", () => {
    const missing: string[] = [];
    for (const event of KNOWN_NOTIFICATION_EVENTS) {
      const titleKey = `notifications.${event}.title`;
      const bodyKey = `notifications.${event}.body`;
      for (const [t, tag] of [
        [enT, "en"],
        [arT, "ar"],
      ] as const) {
        if (t(titleKey) === titleKey) missing.push(`${tag}:${titleKey}`);
        if (t(bodyKey) === bodyKey) missing.push(`${tag}:${bodyKey}`);
      }
    }
    expect(missing, `missing notification copy: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps EN/AR placeholder parity on every event sentence", () => {
    const drift: string[] = [];
    for (const event of KNOWN_NOTIFICATION_EVENTS) {
      for (const suffix of ["title", "body"]) {
        const key = `notifications.${event}.${suffix}`;
        const enPh = (enT(key).match(/\{[^}]+\}/g) ?? []).sort();
        const arPh = (arT(key).match(/\{[^}]+\}/g) ?? []).sort();
        if (JSON.stringify(enPh) !== JSON.stringify(arPh)) drift.push(key);
      }
    }
    expect(drift, `placeholder drift on: ${drift.join(", ")}`).toEqual([]);
  });

  it("leaves no placeholder unfilled once the emitted params are applied", () => {
    // The params each emitting RPC actually writes, per the wiring migration.
    const EMITTED: Record<string, Record<string, string | number>> = {
      "rfq.submitted": { requester_name: "A", item_count: 3 },
      "rfq.cancelled": { requester_name: "A" },
      "quotation.submitted": { supplier_name: "B", total: 100 },
      "quotation.accepted": { requester_name: "A", total: 100 },
      "quotation.rejected": { requester_name: "A" },
      "order.created": { requester_name: "A", total: 100 },
      "order.started": { supplier_name: "B" },
      "order.completed": { executing_name: "B" },
      "order.cancelled": { actor_name: "A" },
      "project.created": { executing_name: "B" },
      "project.activated": { executing_name: "B" },
      "project.completed": { executing_name: "B" },
      "verification.approved": {},
      "verification.rejected": {},
      "verification.changes_requested": {},
      "message.sent": { counterparty_name: "A" },
      // Increment 8: job_application_accept / _reject, both to the applicant.
      "job.application.accepted": { org_name: "C", job_title: "T" },
      "job.application.rejected": { org_name: "C", job_title: "T" },
      // Increment 9: the assignment lifecycle. `cancelled` carries the SAME two
      // params on both of its recipient paths, deliberately.
      "job.assignment.ready": { job_title: "T" },
      "job.assignment.completed": { org_name: "C", job_title: "T" },
      "job.assignment.cancelled": { job_title: "T", reason: "R" },
    };

    const unfilled: string[] = [];
    for (const event of KNOWN_NOTIFICATION_EVENTS) {
      const view = toNotificationView(
        row({
          event_type: event,
          title_key: `notifications.${event}.title`,
          body_key: `notifications.${event}.body`,
          params: EMITTED[event],
        }),
        arT,
        "ar",
        NOW,
      );
      if (/\{[^}]+\}/.test(view.title)) unfilled.push(`${event}.title`);
      if (view.body && /\{[^}]+\}/.test(view.body)) unfilled.push(`${event}.body`);
    }
    expect(unfilled, `sentences left holding a placeholder: ${unfilled.join(", ")}`).toEqual([]);
  });
});

describe("a malformed row degrades visibly instead of vanishing or throwing", () => {
  it("shows an unknown event under the neutral translated title, keeping its link", () => {
    const view = toNotificationView(
      row({ event_type: "chat.message", title_key: "notifications.chat.message.title" }),
      enT,
      "en",
      NOW,
    );
    expect(view.degraded).toBe(true);
    expect(view.title).toBe(enT(NOTIFICATION_FALLBACK_TITLE_KEY));
    // Still reaches its record — the row is unrenderable, the EVENT is not.
    expect(view.href).toBe("/b2b/quotations/abc");
    expect(view.body).toBeNull();
  });

  it("degrades the same way in Arabic, in Arabic", () => {
    const view = toNotificationView(row({ event_type: "chat.message" }), arT, "ar", NOW);
    expect(view.title).toBe(ar.notifications.fallback.title);
    expect(view.title).toMatch(/[؀-ۿ]/);
  });

  it("never prints a dotted translation key into the UI", () => {
    const view = toNotificationView(
      row({ title_key: "notifications.nope.missing.title", body_key: "notifications.nope.body" }),
      enT,
      "en",
      NOW,
    );
    expect(view.title).not.toContain("notifications.");
    expect(view.body).toBeNull();
  });

  it("refuses a deep link that is not relative, without dropping the row", () => {
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      const view = toNotificationView(row({ deep_link: bad }), enT, "en", NOW);
      expect(view.href, `${bad} must not become an href`).toBeNull();
      expect(view.title).toBe(en.notifications.quotation.submitted.title);
    }
  });

  it("survives params that are not an object of scalars", () => {
    for (const params of [null, "nope", 42, ["a"], { supplier_name: { deep: 1 } }]) {
      expect(() => toNotificationView(row({ params }), enT, "en", NOW)).not.toThrow();
    }
    // A non-scalar is dropped rather than stringified into "[object Object]".
    const view = toNotificationView(row({ params: { supplier_name: { a: 1 } } }), enT, "en", NOW);
    expect(view.body).not.toContain("[object Object]");
  });

  it("keeps one bad row from shortening the list", () => {
    const views = toNotificationViews(
      [row({ id: "a" }), row({ id: "b", event_type: "nope.unknown" }), row({ id: "c" })],
      enT,
      "en",
      NOW,
    );
    // Every persisted row is accounted for, so the unread badge — which counts
    // rows in the database — can never exceed what the panel shows.
    expect(views.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });
});

/**
 * message.sent — the Chat -> Notifications integration, seen from the READER.
 *
 * The event is deliberately ordinary here: it arrives through the same
 * persisted-key pipeline as every commerce event, and this file asserts that it
 * needs no special component, no special branch, and above all that the pipeline
 * has NOTHING to render the authored message with.
 */
describe("message.sent renders through the generic pipeline", () => {
  const SENDER = "Suez Paints & Coatings";

  /** Exactly the row `send_message` writes for an order-anchored conversation. */
  function messageRow(over: Partial<NotificationSource> = {}): NotificationSource {
    return row({
      event_type: "message.sent",
      deep_link: "/b2b/orders/da000007-0000-4000-8000-000000000007",
      title_key: "notifications.message.sent.title",
      body_key: "notifications.message.sent.body",
      params: { counterparty_name: SENDER },
      ...over,
    });
  }

  it("resolves English copy from the stored keys and params", () => {
    const view = toNotificationView(messageRow(), enT, "en", NOW);
    expect(view.title).toBe(en.notifications.message.sent.title);
    expect(view.body).toBe(`${SENDER} sent a new message about this transaction.`);
    expect(view.href).toBe("/b2b/orders/da000007-0000-4000-8000-000000000007");
  });

  it("resolves Arabic copy from the same stored keys and params", () => {
    const view = toNotificationView(messageRow(), arT, "ar", NOW);
    expect(view.title).toBe(ar.notifications.message.sent.title);
    expect(view.body).toContain(SENDER);
    // The Arabic sentence, not the English one, and not a bare key.
    expect(view.body).toContain("رسالة جديدة");
    expect(view.body).not.toContain("sent a new message");
  });

  it("is a KNOWN event, so it never degrades to the neutral fallback", () => {
    const view = toNotificationView(messageRow(), enT, "en", NOW);
    expect(view.degraded).toBe(false);
    expect(view.title).not.toBe(enT(NOTIFICATION_FALLBACK_TITLE_KEY));
    expect(KNOWN_NOTIFICATION_EVENTS).toContain("message.sent");
  });

  it("keeps exact EN/AR key parity for the pair", () => {
    for (const suffix of ["title", "body"] as const) {
      const key = `notifications.message.sent.${suffix}`;
      expect(enT(key), `EN missing ${key}`).not.toBe(key);
      expect(arT(key), `AR missing ${key}`).not.toBe(key);
    }
    expect(Object.keys(en.notifications.message.sent).sort()).toEqual(
      Object.keys(ar.notifications.message.sent).sort(),
    );
  });

  /**
   * THE PRIVACY ASSERTION. The authored body is never persisted into the
   * notification row, so even a row that smuggles one in has no placeholder to
   * put it in — the rendered sentence must stay the same either way. This is the
   * property that keeps private correspondence behind the Chat authorization
   * path instead of half-mirrored into an inbox with different visibility rules.
   */
  it("cannot render the authored Chat message, even if a row carries one", () => {
    const SECRET = "Our floor price is 42,000 EGP — do not share.";
    const clean = toNotificationView(messageRow(), enT, "en", NOW);
    const smuggled = toNotificationView(
      messageRow({ params: { counterparty_name: SENDER, body: SECRET, message: SECRET } }),
      enT,
      "en",
      NOW,
    );

    expect(smuggled.body).toBe(clean.body);
    expect(smuggled.title).toBe(clean.title);
    expect(`${smuggled.title} ${smuggled.body}`).not.toContain(SECRET);
    expect(`${smuggled.title} ${smuggled.body}`).not.toContain("42,000");
  });

  it("neither catalog's sentence has a slot for message content", () => {
    for (const t of [enT, arT]) {
      const placeholders = t("notifications.message.sent.body").match(/\{[^}]+\}/g) ?? [];
      expect(placeholders).toEqual(["{counterparty_name}"]);
    }
  });
});
