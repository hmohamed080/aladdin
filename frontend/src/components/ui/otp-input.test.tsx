import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { OtpInput } from "./otp-input";

/** Render inside a real <form> — the hidden combined-value input and
 * `useFormStatus()`-driven disabled state both depend on a form ancestor. */
function renderOtp(props: Partial<React.ComponentProps<typeof OtpInput>> = {}) {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  const utils = renderWithI18n(
    <form onSubmit={onSubmit} data-testid="form">
      <OtpInput name="token" {...props} />
    </form>,
  );
  return { ...utils, onSubmit };
}

function getBoxes(): HTMLInputElement[] {
  return screen.getAllByRole("textbox") as HTMLInputElement[];
}

/** Indexed access with `noUncheckedIndexedAccess` on — assert instead of `!` at every call site. */
function box(boxes: HTMLInputElement[], i: number): HTMLInputElement {
  const el = boxes[i];
  if (!el) throw new Error(`expected an OTP box at index ${i}`);
  return el;
}

describe("OtpInput", () => {
  it("renders exactly 6 boxes by default, matching the backend's 6-digit contract", () => {
    renderOtp();
    expect(getBoxes()).toHaveLength(6);
  });

  it("respects a custom length", () => {
    renderOtp({ length: 4 });
    expect(getBoxes()).toHaveLength(4);
  });

  it("carries the combined value in one hidden input under `name`", () => {
    const { container } = renderOtp();
    const boxes = getBoxes();
    fireEvent.change(box(boxes, 0), { target: { value: "1" } });
    fireEvent.change(box(boxes, 1), { target: { value: "2" } });
    const hidden = container.querySelector('input[type="hidden"][name="token"]') as HTMLInputElement;
    expect(hidden.value).toBe("12");
  });

  it("auto-advances focus to the next box after a digit", () => {
    renderOtp();
    const boxes = getBoxes();
    box(boxes, 0).focus();
    fireEvent.change(box(boxes, 0), { target: { value: "5" } });
    expect(document.activeElement).toBe(box(boxes, 1));
  });

  it("ignores non-digit input", () => {
    renderOtp();
    const boxes = getBoxes();
    fireEvent.change(box(boxes, 0), { target: { value: "a" } });
    expect(box(boxes, 0).value).toBe("");
  });

  it("Backspace on an empty box moves back and clears the previous digit", () => {
    renderOtp();
    const boxes = getBoxes();
    fireEvent.change(box(boxes, 0), { target: { value: "7" } });
    box(boxes, 1).focus();
    fireEvent.keyDown(box(boxes, 1), { key: "Backspace" });
    expect(document.activeElement).toBe(box(boxes, 0));
    expect(box(boxes, 0).value).toBe("");
  });

  it("ArrowLeft/ArrowRight move focus between boxes", () => {
    renderOtp();
    const boxes = getBoxes();
    box(boxes, 2).focus();
    fireEvent.keyDown(box(boxes, 2), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(box(boxes, 1));
    fireEvent.keyDown(box(boxes, 1), { key: "ArrowRight" });
    expect(document.activeElement).toBe(box(boxes, 2));
  });

  it("distributes a pasted full code across every box and focuses the last filled one", () => {
    const { container } = renderOtp();
    const boxes = getBoxes();
    const clipboardData = { getData: () => "123456" } as unknown as DataTransfer;
    fireEvent.paste(box(boxes, 0), { clipboardData });
    expect(boxes.map((b) => b.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(document.activeElement).toBe(box(boxes, 5));
    const hidden = container.querySelector('input[type="hidden"][name="token"]') as HTMLInputElement;
    expect(hidden.value).toBe("123456");
  });

  it("strips non-digit characters from a paste (e.g. a code copied with surrounding text)", () => {
    renderOtp();
    const boxes = getBoxes();
    const clipboardData = { getData: () => "code: 123456" } as unknown as DataTransfer;
    fireEvent.paste(box(boxes, 0), { clipboardData });
    expect(boxes.map((b) => b.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("calls onComplete once every box holds a digit", () => {
    const onComplete = vi.fn();
    renderOtp({ onComplete });
    const boxes = getBoxes();
    for (let i = 0; i < 5; i++) fireEvent.change(box(boxes, i), { target: { value: String(i + 1) } });
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.change(box(boxes, 5), { target: { value: "6" } });
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("marks every box aria-invalid when `error` is set", () => {
    renderOtp({ error: true });
    for (const el of getBoxes()) expect(el).toHaveAttribute("aria-invalid", "true");
  });

  it("box 0 has no aria-label (relies on the external LabeledField label); later boxes get a positional one", () => {
    renderOtp();
    const boxes = getBoxes();
    expect(box(boxes, 0)).not.toHaveAttribute("aria-label");
    expect(box(boxes, 1)).toHaveAttribute("aria-label");
  });

  it("keeps the group LTR even when rendered in an RTL (Arabic) tree", () => {
    const { container } = renderOtp();
    const group = container.querySelector('[role="group"]')?.parentElement;
    expect(group).toHaveAttribute("dir", "ltr");
  });
});
