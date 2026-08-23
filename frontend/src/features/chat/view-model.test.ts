import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { createTranslator } from "@/lib/i18n/translate";
import { formatDateTime, formatTime } from "@/lib/ui/format";
import {
  CHAT_SUBJECT_TYPES,
  toConversationView,
  toMessageView,
  type ConversationDisplayContext,
  type ConversationSource,
  type MessageSource,
} from "./view-model";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-08-23T12:00:00Z");

const context: ConversationDisplayContext = {
  title: "Bathroom finishing",
  requesterName: "Cairo Ceramics",
  supplierName: "Nile Ceramics",
};

function conversation(over: Partial<ConversationSource> = {}): ConversationSource {
  return {
    id: "c1",
    subject_type: "rfq",
    subject_id: "s1",
    requester_org_id: ORG_A,
    supplier_org_id: ORG_B,
    last_message_at: null,
    created_at: "2026-08-20T09:00:00Z",
    last_read_at: null,
    ...over,
  };
}

describe("conversation views", () => {
  it("falls back from last_message_at to the opened-at timestamp", () => {
    const neverSpoken = toConversationView(
      conversation(),
      context,
      createTranslator("en"),
      "en",
      ORG_A,
      NOW,
    );
    expect(neverSpoken.activityAt).toBe(conversation().created_at);

    const spoken = toConversationView(
      conversation({ last_message_at: "2026-08-23T10:00:00Z" }),
      context,
      createTranslator("en"),
      "en",
      ORG_A,
      NOW,
    );
    expect(spoken.activityAt).toBe("2026-08-23T10:00:00Z");
  });

  it("unread follows last_message_at vs last_read_at — and no row means unread", () => {
    const t = createTranslator("en");
    const unreadNeverOpened = toConversationView(
      conversation({ last_message_at: "2026-08-23T10:00:00Z", last_read_at: null }),
      context,
      t,
      "en",
      ORG_A,
      NOW,
    );
    expect(unreadNeverOpened.unread).toBe(true);

    const read = toConversationView(
      conversation({
        last_message_at: "2026-08-23T10:00:00Z",
        last_read_at: "2026-08-23T11:00:00Z",
      }),
      context,
      t,
      "en",
      ORG_A,
      NOW,
    );
    expect(read.unread).toBe(false);

    const staleActivity = toConversationView(
      conversation({
        last_message_at: "2026-08-23T09:00:00Z",
        last_read_at: "2026-08-23T10:00:00Z",
      }),
      context,
      t,
      "en",
      ORG_A,
      NOW,
    );
    expect(staleActivity.unread).toBe(false);
  });

  it("a conversation with no messages yet is never unread", () => {
    const view = toConversationView(conversation(), context, createTranslator("en"), "en", ORG_A, NOW);
    expect(view.unread).toBe(false);
  });

  it("the counterparty is the OTHER organization, resolved only inside a party workspace", () => {
    const t = createTranslator("en");
    const fromRequesterSide = toConversationView(conversation(), context, t, "en", ORG_A, NOW);
    expect(fromRequesterSide.counterpartyName).toBe("Nile Ceramics");

    const fromSupplierSide = toConversationView(conversation(), context, t, "en", ORG_B, NOW);
    expect(fromSupplierSide.counterpartyName).toBe("Cairo Ceramics");

    // Outside both parties — e.g. a personal surface — nothing is invented.
    const outside = toConversationView(conversation(), context, t, "en", null, NOW);
    expect(outside.counterpartyName).toBeNull();
  });

  it("subject labels resolve through the catalog in both locales", () => {
    const enView = toConversationView(conversation(), context, createTranslator("en"), "en", ORG_A, NOW);
    expect(createTranslator("en")(enView.subjectLabelKey ?? "")).toBe(en.chat.subject.rfq);

    const arView = toConversationView(conversation(), context, createTranslator("ar"), "ar", ORG_A, NOW);
    expect(createTranslator("ar")(arView.subjectLabelKey ?? "")).toBe(ar.chat.subject.rfq);
  });

  it("knows exactly the three subject types the database allows — and project is not one", () => {
    expect([...CHAT_SUBJECT_TYPES]).toEqual(["rfq", "quotation", "order"]);
    expect(CHAT_SUBJECT_TYPES).not.toContain("project");

    const unknown = toConversationView(
      conversation({ subject_type: "project" }),
      context,
      createTranslator("en"),
      "en",
      ORG_A,
      NOW,
    );
    expect(unknown.subjectLabelKey).toBeNull();
  });
});

describe("message views", () => {
  const sides = { requesterOrgId: ORG_A, supplierOrgId: ORG_B };

  function message(over: Partial<MessageSource> = {}): MessageSource {
    return {
      id: "m1",
      sender_user_id: "user-1",
      sender_organization_id: ORG_A,
      body: "مرحبًا، بخصوص طلب عرض السعر",
      created_at: "2026-08-23T10:00:00Z",
      ...over,
    };
  }

  const viewer = { userId: "user-1", activeOrgId: ORG_A, activeOrgName: "Cairo Ceramics" };

  it("renders authored Arabic exactly as persisted — byte-identical, never translated", () => {
    const body = "السعر النهائي ٤٨٥٠ جنيهًا — including delivery.\nالسطر الثاني";
    const view = toMessageView(message({ body }), sides, viewer, "en", NOW);
    expect(view.body).toBe(body);
    expect(view.body).toBeTypeOf("string");
  });

  it("derives side, own-side and current-user from already-authorized data only", () => {
    const ours = toMessageView(message(), sides, viewer, "en", NOW);
    expect(ours.side).toBe("requester");
    expect(ours.fromActiveOrg).toBe(true);
    expect(ours.fromCurrentUser).toBe(true);

    const colleague = toMessageView(
      message({ sender_user_id: "user-2" }),
      sides,
      viewer,
      "en",
      NOW,
    );
    expect(colleague.fromActiveOrg).toBe(true);
    expect(colleague.fromCurrentUser).toBe(false);

    const counterparty = toMessageView(
      message({ sender_organization_id: ORG_B, sender_user_id: "user-9" }),
      sides,
      viewer,
      "en",
      NOW,
    );
    expect(counterparty.side).toBe("supplier");
    expect(counterparty.fromActiveOrg).toBe(false);
    expect(counterparty.fromCurrentUser).toBe(false);
  });

  it("preserves the order it is given — chronology stays the query layer's job", () => {
    const rows = [
      message({ id: "m1", created_at: "2026-08-23T10:00:00Z" }),
      message({ id: "m2", created_at: "2026-08-23T10:01:00Z" }),
      message({ id: "m3", created_at: "2026-08-23T10:02:00Z" }),
    ];
    // listMessages hands back oldest-at-top and the mapper must not reorder.
    const out = rows.map((r) => toMessageView(r, sides, viewer, "en", NOW));
    expect(out.map((v) => v.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("timestamps are compact within the same day and carry the date otherwise", () => {
    const today = toMessageView(
      message({ created_at: "2026-08-23T10:00:00Z" }),
      sides,
      viewer,
      "en",
      new Date("2026-08-23T12:00:00Z"),
    );
    const older = toMessageView(
      message({ created_at: "2026-07-01T10:00:00Z" }),
      sides,
      viewer,
      "en",
      new Date("2026-08-23T12:00:00Z"),
    );
    // Same day: a clock time only. Older: the date is present too.
    expect(today.timeLabel).toBe(formatTime("2026-08-23T10:00:00Z", "en"));
    expect(older.timeLabel).toBe(formatDateTime("2026-07-01T10:00:00Z", "en"));
    expect(older.timeLabel).not.toBe(today.timeLabel);
  });
});
