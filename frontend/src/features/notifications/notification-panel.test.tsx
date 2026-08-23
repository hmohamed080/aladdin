import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { createTranslator } from "@/lib/i18n/translate";
import { NotificationsMenu } from "@/components/layout/header-panels";
import { NotificationList } from "./notification-list";
import { toNotificationViews, type NotificationSource } from "./view-model";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * The two approved RPCs, and the assertion is that these — and nothing else —
 * are what the UI calls. `public.notifications` has no write policy, so a direct
 * table write from the client would fail anyway; what these mocks prove is that
 * the app never tries.
 */
type ReadState = { ok: boolean };
const markNotificationReadAction = vi.fn<(id: string) => Promise<ReadState>>();
const markAllNotificationsReadAction = vi.fn<(orgId?: string | null) => Promise<ReadState>>();
vi.mock("@/server/actions/notifications", () => ({
  markNotificationReadAction: (id: string) => markNotificationReadAction(id),
  markAllNotificationsReadAction: (orgId?: string | null) =>
    markAllNotificationsReadAction(orgId),
}));

/* `header-panels` now mounts Chat beside Notifications; its server-side action
   module must never resolve here either. */
vi.mock("@/server/actions/chat", () => ({
  CHAT_ACCESS_DENIED: "chat.error.access",
  openConversationAction: vi.fn(async () => ({ ok: true })),
  sendMessageAction: vi.fn(async () => ({ ok: true })),
  markConversationReadAction: vi.fn(async () => ({ ok: true })),
  loadConversationThreadAction: vi.fn(async () => ({ ok: true, messages: [] })),
}));

const ORG = "org-1";

function source(over: Partial<NotificationSource> = {}): NotificationSource {
  return {
    id: "n1",
    event_type: "quotation.submitted",
    deep_link: "/b2b/quotations/q-1",
    title_key: "notifications.quotation.submitted.title",
    body_key: "notifications.quotation.submitted.body",
    params: { supplier_name: "Nile Ceramics", total: 48500 },
    read_at: null,
    created_at: "2026-08-22T09:00:00Z",
    organization_id: ORG,
    ...over,
  };
}

const views = (rows: NotificationSource[], locale: "en" | "ar" = "en") =>
  toNotificationViews(rows, createTranslator(locale), locale, new Date("2026-08-22T12:00:00Z"));

const openPanel = () => fireEvent.click(screen.getByTestId("header-notifications"));

beforeEach(() => {
  vi.clearAllMocks();
  markNotificationReadAction.mockResolvedValue({ ok: true });
  markAllNotificationsReadAction.mockResolvedValue({ ok: true });
});

describe("the header panel keeps its shell and gains a body", () => {
  it("shows the honest empty state when there is nothing", () => {
    renderWithI18n(<NotificationsMenu />, "en");
    openPanel();
    expect(screen.getByText(en.notifications.empty.title)).toBeInTheDocument();
    expect(screen.queryByTestId("notification-list")).toBeNull();
  });

  it("renders the persisted notifications when there are some", () => {
    renderWithI18n(
      <NotificationsMenu
        items={views([source(), source({ id: "n2", event_type: "order.started",
          title_key: "notifications.order.started.title",
          body_key: "notifications.order.started.body",
          params: { supplier_name: "Delta" }, deep_link: "/b2b/orders/o-1" })])}
        unreadCount={2}
        orgId={ORG}
      />,
      "en",
    );
    openPanel();
    expect(screen.getByText(en.notifications.quotation.submitted.title)).toBeInTheDocument();
    expect(screen.getByText(en.notifications.order.started.title)).toBeInTheDocument();
    expect(screen.queryByText(en.notifications.empty.title)).toBeNull();
  });

  it("keeps the panel a dialog that Escape and an outside click still close", () => {
    renderWithI18n(<NotificationsMenu items={views([source()])} unreadCount={1} />, "en");
    openPanel();
    expect(screen.getByTestId("header-notifications-panel")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("header-notifications-panel")).toBeNull();

    openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("header-notifications-panel")).toBeNull();
  });

  it("navigates via the STORED relative deep link", () => {
    renderWithI18n(<NotificationsMenu items={views([source()])} unreadCount={1} />, "en");
    openPanel();
    expect(screen.getByTestId("notification-row")).toHaveAttribute(
      "href",
      "/b2b/quotations/q-1",
    );
  });
});

describe("unread state is legible without relying on colour", () => {
  it("marks an unread row for a screen reader, and leaves a read row unmarked", () => {
    renderWithI18n(
      <NotificationsMenu
        items={views([source({ id: "n1" }), source({ id: "n2", read_at: "2026-08-22T10:00:00Z" })])}
        unreadCount={1}
      />,
      "en",
    );
    openPanel();
    const rows = screen.getAllByTestId("notification-row");
    const [unread, read] = [rows[0]!, rows[1]!];
    expect(unread).toHaveAttribute("data-unread", "true");
    expect(read).toHaveAttribute("data-unread", "false");
    // The word, not the dot — the dot is aria-hidden.
    expect(unread.textContent).toContain(en.notifications.unread);
    expect(read.textContent).not.toContain(en.notifications.unread);
  });
});

describe("the unread badge is a counted number or nothing at all", () => {
  it("shows no badge at zero unread", () => {
    renderWithI18n(<NotificationsMenu items={views([source({ read_at: "x" })])} unreadCount={0} />, "en");
    expect(screen.queryByTestId("header-notifications-badge")).toBeNull();
  });

  it("shows the server's count, and names it for a screen reader", () => {
    renderWithI18n(<NotificationsMenu items={views([source()])} unreadCount={3} />, "en");
    expect(screen.getByTestId("header-notifications-badge")).toHaveTextContent("3");
    expect(screen.getByTestId("header-notifications")).toHaveAccessibleName(
      `${en.nav.notifications} — ${createTranslator("en")("notifications.unreadCount", { count: 3 })}`,
    );
  });

  it("decrements when a row is read, with no browser reload", async () => {
    renderWithI18n(
      <NotificationsMenu items={views([source(), source({ id: "n2" })])} unreadCount={2} orgId={ORG} />,
      "en",
    );
    openPanel();
    expect(screen.getByTestId("header-notifications-badge")).toHaveTextContent("2");

    fireEvent.click(screen.getAllByTestId("notification-row")[0]!);

    await waitFor(() =>
      expect(screen.getByTestId("header-notifications-badge")).toHaveTextContent("1"),
    );
    // The server stays the source of truth: the optimistic number is reconciled
    // by a route refresh, not left to drift.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("disappears entirely once everything is marked read", async () => {
    renderWithI18n(
      <NotificationsMenu items={views([source(), source({ id: "n2" })])} unreadCount={2} orgId={ORG} />,
      "en",
    );
    openPanel();
    fireEvent.click(screen.getByTestId("notifications-mark-all"));
    await waitFor(() => expect(screen.queryByTestId("header-notifications-badge")).toBeNull());
  });
});

describe("read state goes through the approved RPCs and nothing else", () => {
  it("marks ONE read on activating a row, passing that row's id", async () => {
    renderWithI18n(<NotificationsMenu items={views([source({ id: "n-42" })])} unreadCount={1} />, "en");
    openPanel();
    fireEvent.click(screen.getByTestId("notification-row"));
    await waitFor(() => expect(markNotificationReadAction).toHaveBeenCalledWith("n-42"));
    expect(markAllNotificationsReadAction).not.toHaveBeenCalled();
  });

  it("marks ALL read scoped to the workspace the list was scoped to", async () => {
    renderWithI18n(
      <NotificationsMenu items={views([source(), source({ id: "n2" })])} unreadCount={2} orgId={ORG} />,
      "en",
    );
    openPanel();
    fireEvent.click(screen.getByTestId("notifications-mark-all"));
    await waitFor(() => expect(markAllNotificationsReadAction).toHaveBeenCalledWith(ORG));
  });

  it("does not re-mark a row the database already recorded as read", () => {
    renderWithI18n(
      <NotificationsMenu items={views([source({ read_at: "2026-08-22T10:00:00Z" })])} unreadCount={0} />,
      "en",
    );
    openPanel();
    const row = screen.getByTestId("notification-row");
    // Still navigable — reading is not what makes a notice worth opening.
    expect(row).toHaveAttribute("href", "/b2b/quotations/q-1");
    fireEvent.click(row);
    expect(markNotificationReadAction).not.toHaveBeenCalled();
  });

  it("offers no 'mark all' when nothing is unread", () => {
    renderWithI18n(
      <NotificationsMenu items={views([source({ read_at: "2026-08-22T10:00:00Z" })])} unreadCount={0} />,
      "en",
    );
    openPanel();
    expect(screen.queryByTestId("notifications-mark-all")).toBeNull();
  });
});

describe("the panel reads in the reader's language", () => {
  it("renders Arabic copy under the Arabic locale", () => {
    renderWithI18n(
      <NotificationsMenu items={views([source()], "ar")} unreadCount={1} />,
      "ar",
    );
    openPanel();
    expect(screen.getByText(ar.notifications.quotation.submitted.title)).toBeInTheDocument();
    expect(screen.getByTestId("notifications-mark-all")).toHaveTextContent(
      ar.notifications.markAllRead,
    );
  });

  it("renders English copy under the English locale", () => {
    renderWithI18n(<NotificationsMenu items={views([source()])} unreadCount={1} />, "en");
    openPanel();
    expect(screen.getByText(en.notifications.quotation.submitted.title)).toBeInTheDocument();
    expect(screen.getByTestId("notifications-mark-all")).toHaveTextContent(
      en.notifications.markAllRead,
    );
  });
});

describe("a malformed row does not take the panel down with it", () => {
  it("renders the neutral fallback beside its healthy neighbours", () => {
    renderWithI18n(
      <NotificationsMenu
        items={views([source({ id: "a" }), source({ id: "b", event_type: "chat.message" }), source({ id: "c" })])}
        unreadCount={3}
      />,
      "en",
    );
    openPanel();
    expect(screen.getAllByTestId("notification-row")).toHaveLength(3);
    expect(screen.getByText(en.notifications.fallback.title)).toBeInTheDocument();
  });

  it("renders a row with an unusable deep link as a button, not a dead link", async () => {
    renderWithI18n(
      <NotificationsMenu items={views([source({ deep_link: "https://evil.example" })])} unreadCount={1} />,
      "en",
    );
    openPanel();
    const row = screen.getByTestId("notification-row");
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toHaveAttribute("href");
    // Still keyboard-reachable and still markable, so it cannot become a notice
    // the reader is unable to clear.
    fireEvent.click(row);
    await waitFor(() => expect(markNotificationReadAction).toHaveBeenCalled());
  });
});

describe("the supply dashboard block is the same list at a different density", () => {
  const items = views([source(), source({ id: "n2" })]);

  it("renders the same persisted rows and the same deep links", () => {
    renderWithI18n(<NotificationList items={items} orgId={ORG} dense showMarkAll={false} />, "en");
    const rows = screen.getAllByTestId("notification-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveAttribute("href", "/b2b/quotations/q-1");
    expect(rows[0]!).toHaveAttribute("data-unread", "true");
  });

  it("drops the body line for density but keeps the title and the time", () => {
    renderWithI18n(<NotificationList items={items} orgId={ORG} dense showMarkAll={false} />, "en");
    expect(screen.getAllByText(en.notifications.quotation.submitted.title).length).toBe(2);
    expect(screen.queryByText(/Nile Ceramics/)).toBeNull();
  });

  it("carries no 'mark all' — that control belongs to the inbox, not to a summary of it", () => {
    renderWithI18n(<NotificationList items={items} orgId={ORG} dense showMarkAll={false} />, "en");
    expect(screen.queryByTestId("notifications-mark-all")).toBeNull();
  });

  it("marks read through the same approved RPC as the header", async () => {
    renderWithI18n(<NotificationList items={items} orgId={ORG} dense showMarkAll={false} />, "en");
    fireEvent.click(screen.getAllByTestId("notification-row")[1]!);
    await waitFor(() => expect(markNotificationReadAction).toHaveBeenCalledWith("n2"));
  });
});
