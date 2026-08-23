import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

vi.mock("server-only", () => ({}));

/**
 * The approved Chat RPCs, and the assertion that these — and NOTHING else — are
 * what application code calls. All three Chat tables carry SELECT grants only,
 * so a direct table write would fail in the database anyway; these tests pin
 * that the app never even tries, and never supplies an identity the database is
 * supposed to derive.
 */
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ rpc }) as unknown as SupabaseClient<Database>),
}));

import {
  loadConversationThreadAction,
  markConversationReadAction,
  openConversationAction,
  sendMessageAction,
} from "./chat";
import { CHAT_ACCESS_DENIED } from "@/features/chat/view-model";
import * as chatQueries from "@/server/queries/chat";

const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openConversationAction", () => {
  it("calls open_conversation with subject type and id only", async () => {
    rpc.mockResolvedValue({ data: CONVERSATION_ID, error: null });
    const result = await openConversationAction("rfq", SUBJECT_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("open_conversation", {
      p_subject_type: "rfq",
      p_subject_id: SUBJECT_ID,
    });
    expect(result).toEqual({ ok: true, conversationId: CONVERSATION_ID });
  });

  it("never sends an organization id — parties are derived by the database", async () => {
    rpc.mockResolvedValue({ data: CONVERSATION_ID, error: null });
    await openConversationAction("order", SUBJECT_ID);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(["p_subject_type", "p_subject_id"]);
  });

  it("maps 42501 to the neutral access state", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("conversation.participate is required"), { code: "42501" }),
    });
    const result = await openConversationAction("rfq", SUBJECT_ID);
    expect(result).toEqual({ ok: false, code: CHAT_ACCESS_DENIED });
  });
});

describe("sendMessageAction", () => {
  it("calls send_message with conversation id and body only", async () => {
    rpc.mockResolvedValue({ data: MESSAGE_ID, error: null });
    const result = await sendMessageAction(CONVERSATION_ID, "سأرسل العينة غدًا");
    expect(rpc).toHaveBeenCalledWith("send_message", {
      p_conversation_id: CONVERSATION_ID,
      p_body: "سأرسل العينة غدًا",
    });
    expect(result).toEqual({ ok: true, messageId: MESSAGE_ID });
  });

  it("supplies neither sender_user_id nor sender_organization_id — ever", async () => {
    rpc.mockResolvedValue({ data: MESSAGE_ID, error: null });
    await sendMessageAction(CONVERSATION_ID, "hello");
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_conversation_id"]);
  });

  it("refuses whitespace-only bodies at the boundary without calling the RPC", async () => {
    for (const body of ["", "   ", "\n\t "]) {
      await sendMessageAction(CONVERSATION_ID, body);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks over-4000-character bodies at the UI boundary; DB stays final authority", async () => {
    await sendMessageAction(CONVERSATION_ID, "a".repeat(4001));
    expect(rpc).not.toHaveBeenCalled();
    // Exactly at the limit the message goes through untouched.
    rpc.mockResolvedValue({ data: MESSAGE_ID, error: null });
    const result = await sendMessageAction(CONVERSATION_ID, "a".repeat(4000));
    expect(result.ok).toBe(true);
  });

  it("preserves authored Arabic byte-for-byte on its way to the database", async () => {
    rpc.mockResolvedValue({ data: MESSAGE_ID, error: null });
    const body = "السعر ٤٨٥٠ جنيهًا — including delivery\tsecond line";
    await sendMessageAction(CONVERSATION_ID, body);
    expect((rpc.mock.calls[0]![1] as Record<string, unknown>).p_body).toBe(body);
  });
});

describe("markConversationReadAction", () => {
  it("calls mark_conversation_read with the conversation id only", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await markConversationReadAction(CONVERSATION_ID);
    expect(rpc).toHaveBeenCalledWith("mark_conversation_read", {
      p_conversation_id: CONVERSATION_ID,
    });
    expect(result).toEqual({ ok: true });
  });

  it("maps a lost-access 42501 to the same neutral access state", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("conversation not found"), { code: "42501" }),
    });
    await expect(markConversationReadAction(CONVERSATION_ID)).resolves.toEqual({
      ok: false,
      code: CHAT_ACCESS_DENIED,
    });
  });
});

describe("loadConversationThreadAction", () => {
  it("returns persisted messages through the RLS-scoped reads", async () => {
    const messages = [
      { id: MESSAGE_ID, conversation_id: CONVERSATION_ID, sender_user_id: "u1", sender_organization_id: "o1", body: "مرحبًا", created_at: "2026-08-23T10:00:00Z" },
    ];
    const getSpy = vi.spyOn(chatQueries, "getConversation").mockResolvedValue({
      id: CONVERSATION_ID,
      subject_type: "order",
      subject_id: SUBJECT_ID,
      requester_org_id: "o1",
      supplier_org_id: "o2",
      last_message_at: "2026-08-23T10:00:00Z",
      created_at: "2026-08-20T09:00:00Z",
    });
    vi.spyOn(chatQueries, "listMessages").mockResolvedValue(messages);

    const result = await loadConversationThreadAction(CONVERSATION_ID);
    expect(result).toEqual({ ok: true, messages });
    expect(getSpy).toHaveBeenCalledWith(expect.anything(), CONVERSATION_ID);
  });

  it("an invisible conversation collapses to the neutral access code — no metadata", async () => {
    vi.spyOn(chatQueries, "getConversation").mockResolvedValue(null);
    const listSpy = vi.spyOn(chatQueries, "listMessages");
    const result = await loadConversationThreadAction("gone-or-foreign");
    expect(result).toEqual({ ok: false, code: CHAT_ACCESS_DENIED });
    expect(listSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("subject");
    expect(JSON.stringify(result)).not.toContain("org");
  });
});
