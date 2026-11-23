import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/server/actions/admin-forms", () => ({ approveVerificationAction: vi.fn(), rejectVerificationAction: vi.fn(), adminInitiateVerificationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { UserVerificationControls } = await import("./user-verification-controls");

const pending = (verificationType: string) => ({ id: "99999999-9999-4999-8999-999999999999", status: "submitted", verificationType });
const show = (verificationType: string) =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <UserVerificationControls subjectId="u1" pending={pending(verificationType)} />
    </I18nProvider>,
  );
afterEach(cleanup);

describe("UserVerificationControls", () => {
  it("makes public listing an explicit, visible choice for a professional approval (unticked by default: approving never publishes on its own)", () => {
    show("professional");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const box = screen.getByRole("checkbox", { name: /list this profile publicly/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.name).toBe("grantListing");
    fireEvent.click(box);
    expect(box.checked).toBe(true);
  });

  it("offers no listing choice for an identity verification", () => {
    show("identity");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("makes the rejection reason optional", () => {
    show("professional");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect((document.querySelector('textarea[name="reason"]') as HTMLTextAreaElement).required).toBe(false);
  });

  it("offers live Approve / Reject with the subject in hidden fields (no Start step, no reason on approve) when no request exists and the caller may initiate", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <UserVerificationControls subjectId="11111111-1111-4111-8111-111111111111" pending={null} subjectType="organization" canInitiate />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Start verification" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(document.querySelector('textarea[name="reason"]')).toBeNull();
    expect(document.querySelector('input[name="id"]')).toBeNull();
    expect((document.querySelector('input[name="subjectType"]') as HTMLInputElement).value).toBe("organization");
    expect((document.querySelector('input[name="subjectId"]') as HTMLInputElement).value).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("keeps the disabled Approve / Reject (no Start) when the caller may not initiate", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <UserVerificationControls subjectId="u1" pending={null} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Start verification" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Approve/ })[0]?.getAttribute("aria-disabled")).toBe("true");
  });
  it("RECOVERY offers ONLY \"Complete approval\" for the exact approved request: no Reject, no Start, no listing choice", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <UserVerificationControls subjectId="u1" pending={{ id: "99999999-9999-4999-8999-999999999999", status: "approved", verificationType: "professional" }} recovery />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Start verification/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete approval" }));
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe("99999999-9999-4999-8999-999999999999");
    expect(document.querySelector('input[name="subjectType"]')).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
