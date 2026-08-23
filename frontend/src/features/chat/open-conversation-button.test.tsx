import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { OpenConversationButton } from "./open-conversation-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** Mocked wholesale — the real module imports `server-only`. */
const mocks = vi.hoisted(() => ({
  open: vi.fn<(s: string, id: string) => Promise<{ ok: boolean; conversationId?: string }>>(),
}));

vi.mock("@/server/actions/chat", () => ({
  openConversationAction: mocks.open,
}));

const openConversationAction = mocks.open;

/**
 * The entry point's whole contract: name the subject it is standing on — and
 * nothing else. Party organizations are derived inside `open_conversation` from
 * the authoritative row, so any organization id here would be an authority claim
 * the architecture forbids.
 */
const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  openConversationAction.mockResolvedValue({ ok: true, conversationId: CONVERSATION_ID });
});

describe.each(["rfq", "quotation", "order"] as const)(
  "the %s chat entry action",
  (subjectType) => {
    it(`calls open_conversation with subject_type=${subjectType} and the record's own id`, async () => {
      renderWithI18n(<OpenConversationButton subjectType={subjectType} subjectId={SUBJECT_ID} />, "en");
      fireEvent.click(screen.getByTestId(`chat-open-${subjectType}`));
      await vi.waitFor(() =>
        expect(openConversationAction).toHaveBeenCalledWith(subjectType, SUBJECT_ID),
      );
    });

    it("supplies no organization ids of any kind", async () => {
      renderWithI18n(<OpenConversationButton subjectType={subjectType} subjectId={SUBJECT_ID} />, "en");
      fireEvent.click(screen.getByTestId(`chat-open-${subjectType}`));
      await vi.waitFor(() => expect(openConversationAction).toHaveBeenCalled());
      const args = openConversationAction.mock.calls[0]!;
      expect(args[0]).toBe(subjectType);
      expect(args).toHaveLength(2);
      expect(JSON.stringify(args)).not.toMatch(/org/i);
    });
  },
);

describe("no project chat subject exists", () => {
  it("the button cannot even express a project subject", () => {
    // A project conversation would fragment the parent order's thread
    // (chat-core.md §4.3); the type system is what keeps it out.
    const invalid = ["project", "consumer", ""].map((s) => function ForbiddenSubject() {
      // @ts-expect-error — deliberately proving the compile-time exclusion.
      return <OpenConversationButton subjectType={s} subjectId={SUBJECT_ID} />;
    });
    expect(invalid).toHaveLength(3);
  });
});
