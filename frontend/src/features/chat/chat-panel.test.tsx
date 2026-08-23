import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { createTranslator } from "@/lib/i18n/translate";
import { ChatMenu } from "@/components/layout/header-panels";
import {
  toConversationView,
  type ConversationDisplayContext,
  type ConversationSource,
} from "./view-model";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/* `header-panels` also mounts the notifications list, whose action module is
   server-side; mocked wholesale for the same reason as the chat one below. */
vi.mock("@/server/actions/notifications", () => ({
  markNotificationReadAction: vi.fn(async () => ({ ok: true })),
  markAllNotificationsReadAction: vi.fn(async () => ({ ok: true })),
}));

/**
 * The three approved write paths and the one read path, mocked wholesale — the
 * real module imports `server-only`, which must never resolve in a client test.
 * The access code is duplicated here as the stable contract value it is.
 */
const mocks = vi.hoisted(() => ({
  loadThread: vi.fn<(id: string) => Promise<unknown>>(),
  sendAction: vi.fn<(c: string, b: string) => Promise<{ ok: boolean; code?: string }>>(),
  markRead: vi.fn<(c: string) => Promise<{ ok: boolean; code?: string }>>(),
}));

vi.mock("@/server/actions/chat", () => ({
  loadConversationThreadAction: mocks.loadThread,
  sendMessageAction: mocks.sendAction,
  markConversationReadAction: mocks.markRead,
}));

const CHAT_ACCESS_DENIED = "chat.error.access";

const loadThread = mocks.loadThread;
const sendAction = mocks.sendAction;
const markRead = mocks.markRead;

type ThreadMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_organization_id: string;
  body: string;
  created_at: string;
};

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "user-me";
const NOW = new Date("2026-08-23T12:00:00Z");

const context: ConversationDisplayContext = {
  title: "Bathroom finishing",
  requesterName: "Cairo Ceramics",
  supplierName: "Nile Ceramics",
};

function source(over: Partial<ConversationSource> = {}): ConversationSource {
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

function buildViews(
  rows: ConversationSource[],
  locale: "en" | "ar" = "en",
  activeOrgId: string | null = ORG_A,
) {
  return rows.map((row) =>
    toConversationView(row, context, createTranslator(locale), locale, activeOrgId, NOW),
  );
}

const openPanel = () => fireEvent.click(screen.getByTestId("header-chat"));

beforeEach(() => {
  vi.clearAllMocks();
  loadThread.mockResolvedValue({ ok: true, messages: [] as ThreadMessage[] });
  sendAction.mockResolvedValue({ ok: true });
  markRead.mockResolvedValue({ ok: true });
});

describe("the header chat shell", () => {
  it("keeps the honest empty state when there are zero conversations", () => {
    renderWithI18n(<ChatMenu />, "en");
    openPanel();
    expect(screen.getByText(en.chat.empty.title)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-conversation-list")).toBeNull();
    expect(screen.queryByTestId("header-chat-badge")).toBeNull();
  });

  it("renders real accessible conversations when there are some", () => {
    const items = buildViews([
      source(),
      source({
        id: "c2",
        subject_type: "order",
        subject_id: "s2",
        last_message_at: "2026-08-23T10:00:00Z",
        // Read, so the row text is exactly what the assertions below expect
        // (an unread row carries an extra screen-reader word).
        last_read_at: "2026-08-23T11:00:00Z",
      }),
    ]);
    renderWithI18n(<ChatMenu items={items} unreadCount={0} activeOrgId={ORG_A} />, "en");
    openPanel();
    const rows = screen.getAllByTestId("chat-conversation-row");
    expect(rows).toHaveLength(2);
    // Scoped per row: both rows share a counterparty and a subject title, so a
    // global query could never tell them apart.
    expect(within(rows[0]!).getByText("Request for quotation · Nile Ceramics")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(context.title ?? "")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Order · Nile Ceramics")).toBeInTheDocument();
  });

  it("communicates unread without colour alone", () => {
    const items = buildViews([
      source({ last_message_at: "2026-08-23T10:00:00Z", last_read_at: null }),
    ]);
    renderWithI18n(<ChatMenu items={items} unreadCount={1} activeOrgId={ORG_A} />, "en");
    openPanel();
    const row = screen.getByTestId("chat-conversation-row");
    expect(row.getAttribute("data-unread")).toBe("true");
    // The word rides the row for screen readers; the dot is never the only cue.
    expect(screen.getByText(new RegExp(en.chat.unread))).toBeInTheDocument();
  });

  it("shows the REAL unread-conversation count as the badge", () => {
    const items = buildViews([source()]);
    // The server says two conversations hold something unseen even though only
    // one fits under this list's bound: the badge counts the database, not rows.
    renderWithI18n(<ChatMenu items={items} unreadCount={2} activeOrgId={ORG_A} />, "en");
    expect(screen.getByTestId("header-chat-badge").textContent).toBe("2");
    expect(screen.getByTestId("header-chat").getAttribute("aria-label")).toBe(
      `Chat — ${en.chat.unreadCount.replace("{count}", "2")}`,
    );
  });

  it("reconciles the badge after opening a thread marks it read — no reload", async () => {
    const items = buildViews([
      source({ last_message_at: "2026-08-23T10:00:00Z", last_read_at: null }),
    ]);
    renderWithI18n(
      <ChatMenu items={items} unreadCount={1} activeOrgId={ORG_A} currentUserId={ME} />,
      "en",
    );
    openPanel();
    fireEvent.click(screen.getByTestId("chat-conversation-row"));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByTestId("header-chat-badge")).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it("renders system copy in Arabic when the reader is Arabic", () => {
    renderWithI18n(<ChatMenu />, "ar");
    openPanel();
    expect(screen.getByText(ar.chat.empty.title)).toBeInTheDocument();
  });
});

describe("opening a thread inside the panel", () => {
  const unreadRow = source({
    last_message_at: "2026-08-23T10:00:00Z",
    last_read_at: null,
  });

  const msg = (over: Partial<ThreadMessage>): ThreadMessage => ({
    id: "m1",
    conversation_id: "c1",
    sender_user_id: "user-them",
    sender_organization_id: ORG_B,
    body: "مرحبًا",
    created_at: "2026-08-23T09:00:00Z",
    ...over,
  });

  function renderThread(locale: "en" | "ar" = "en") {
    const items = buildViews([unreadRow], locale);
    renderWithI18n(
      <ChatMenu
        items={items}
        unreadCount={1}
        activeOrgId={ORG_A}
        activeOrgName="Cairo Ceramics"
        currentUserId={ME}
      />,
      locale,
    );
    openPanel();
    fireEvent.click(screen.getByTestId("chat-conversation-row"));
  }

  it("renders persisted messages chronologically with side presentation", async () => {
    loadThread.mockResolvedValue({
      ok: true,
      messages: [
        msg({
          id: "m1",
          sender_user_id: "user-them",
          sender_organization_id: ORG_B,
          body: "مرحبًا، بخصوص طلب عرض السعر",
          created_at: "2026-08-23T09:00:00Z",
        }),
        msg({
          id: "m2",
          sender_user_id: ME,
          sender_organization_id: ORG_A,
          body: "Hello — we received your quotation.",
          created_at: "2026-08-23T09:30:00Z",
        }),
      ],
    });

    renderThread();

    await screen.findByTestId("chat-message-list");
    const messages = screen.getAllByTestId("chat-message");
    expect(messages).toHaveLength(2);
    expect(messages[0]?.getAttribute("data-side")).toBe("supplier");
    expect(messages[0]?.textContent).toContain("مرحبًا، بخصوص طلب عرض السعر");
    expect(messages[0]?.textContent).toContain("Nile Ceramics");
    expect(messages[1]?.getAttribute("data-side")).toBe("requester");
    expect(messages[1]?.textContent).toContain(en.chat.thread.you);

    // Reading the thread IS marking it read.
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("c1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("sends, then shows the persisted truth after re-read and route refresh", async () => {
    loadThread.mockResolvedValueOnce({ ok: true, messages: [msg({})] });
    renderThread();
    await screen.findByText("مرحبًا");

    // The database trims edges; the re-read reflects exactly what was stored.
    loadThread.mockResolvedValueOnce({
      ok: true,
      messages: [
        msg({}),
        msg({
          id: "m2",
          sender_user_id: ME,
          sender_organization_id: ORG_A,
          body: "تمام، نتابع",
          created_at: "2026-08-23T10:05:00Z",
        }),
      ],
    });

    fireEvent.change(screen.getByTestId("chat-composer"), {
      target: { value: "  تمام، نتابع  " },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(sendAction).toHaveBeenCalledWith("c1", "  تمام، نتابع  "));
    await screen.findByText("تمام، نتابع");
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses whitespace-only submission and blocks over-limit input at the boundary", async () => {
    loadThread.mockResolvedValue({ ok: true, messages: [msg({})] });
    renderThread();
    await screen.findByTestId("chat-message-list");

    const composer = screen.getByTestId("chat-composer") as HTMLTextAreaElement;
    const send = screen.getByTestId("chat-send") as HTMLButtonElement;

    expect(composer.getAttribute("maxlength")).toBe("4000");
    expect(send.disabled).toBe(true); // empty

    fireEvent.change(composer, { target: { value: "   \n\t" } });
    expect(send.disabled).toBe(true);

    fireEvent.change(composer, { target: { value: "a".repeat(4001) } });
    // The guard blocks submission and says so; the rendered count goes through
    // the locale formatter like every other user-facing number ("4,000").
    expect(composer.value.length).toBe(4001);
    expect(send.disabled).toBe(true);
    expect(
      screen.getByText(createTranslator("en")("chat.composer.tooLong", { count: 4000 })),
    ).toBeInTheDocument();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("cannot duplicate-send while a send is pending", async () => {
    let release!: (v: { ok: boolean }) => void;
    sendAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    loadThread.mockResolvedValue({ ok: true, messages: [msg({})] });
    renderThread();
    await screen.findByTestId("chat-message-list");

    fireEvent.change(screen.getByTestId("chat-composer"), {
      target: { value: "one message only" },
    });
    const send = screen.getByTestId("chat-send");
    fireEvent.click(send);
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    fireEvent.click(send);
    release({ ok: true });
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
  });

  it("authorization failure renders the neutral state and leaks nothing", async () => {
    loadThread.mockResolvedValue({ ok: false, code: CHAT_ACCESS_DENIED });
    renderThread();

    await screen.findByText(en.chat.error.access);
    expect(screen.queryByTestId("chat-message-list")).toBeNull();
    expect(screen.queryByText(context.title ?? "")).toBeNull();
    expect(screen.queryByText("Nile Ceramics")).toBeNull();
    expect(markRead).not.toHaveBeenCalled();
  });

  it("announces the sending state through the live region", async () => {
    let release!: (v: { ok: boolean }) => void;
    sendAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    loadThread.mockResolvedValue({ ok: true, messages: [msg({})] });
    renderThread();
    await screen.findByTestId("chat-message-list");
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-send-status").textContent).toBe(en.chat.composer.sending);
    release({ ok: true });
  });

  /**
   * The honest EMPTY THREAD. A browser run can only witness this the FIRST time
   * a given subject is opened — every later run finds the history it just wrote —
   * so the durable assertion lives here, where the state is constructed rather
   * than depended upon.
   */
  it("a conversation with no messages keeps the honest empty thread state", async () => {
    loadThread.mockResolvedValue({ ok: true, messages: [] as ThreadMessage[] });
    renderThread();
    expect(await screen.findByText(en.chat.thread.empty.title)).toBeInTheDocument();
    expect(screen.getByText(en.chat.thread.empty.body)).toBeInTheDocument();
    // Empty is not broken: the composer is still there to start the thread with.
    expect(screen.getByTestId("chat-composer")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-message")).not.toBeInTheDocument();
  });

  it("returns to the list with the back control", async () => {
    renderThread();
    await screen.findByTestId("chat-thread-back");
    fireEvent.click(screen.getByTestId("chat-thread-back"));
    expect(await screen.findByTestId("chat-conversation-list")).toBeInTheDocument();
  });

  it("renders Arabic thread copy in Arabic", async () => {
    loadThread.mockResolvedValue({ ok: true, messages: [] as ThreadMessage[] });
    renderThread("ar");
    await screen.findByText(ar.chat.thread.empty.title);
    expect(screen.getByText(ar.chat.thread.back)).toBeInTheDocument();
    expect(screen.getByText(ar.chat.composer.send)).toBeInTheDocument();
  });
});

describe("the shared shell keeps its dismissal behaviour", () => {
  it("Escape closes the chat panel", () => {
    const items = buildViews([source()]);
    renderWithI18n(<ChatMenu items={items} unreadCount={0} activeOrgId={ORG_A} />, "en");
    openPanel();
    expect(screen.getByTestId("header-chat-panel")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("header-chat-panel")).toBeNull();
  });
});
