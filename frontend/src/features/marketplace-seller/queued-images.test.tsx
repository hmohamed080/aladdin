import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/server/actions/marketplace-seller", () => ({}));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: () => ({}) }));
import { QueuedImages } from "./queued-images";

beforeAll(() => {
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

function Harness() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <I18nProvider locale="ar" dir="rtl">
      <QueuedImages files={files} onChange={setFiles} />
      <output data-testid="count">{files.length}</output>
    </I18nProvider>
  );
}

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type });
const pick = (files: File[]) => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });

describe("QueuedImages (images before the first save)", () => {
  it("keeps picked images locally, the first one as the cover, and removes on request", () => {
    render(<Harness />);
    pick([file("a.jpg", "image/jpeg"), file("b.png", "image/png")]);
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByAltText("a.jpg").getAttribute("src")).toBe("blob:a.jpg");
    expect(screen.getByText("رئيسية")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("إزالة a.jpg"));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("refuses a non-image file and an image over 5 MB, and ignores a duplicate", () => {
    render(<Harness />);
    pick([file("doc.pdf", "application/pdf"), file("big.jpg", "image/jpeg", 5 * 1024 * 1024 + 1), file("ok.webp", "image/webp"), file("ok.webp", "image/webp")]);
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByRole("alert").textContent).toMatch(/big\.jpg/);
  });

  it("stops at the per-product limit of 10 images", () => {
    render(<Harness />);
    pick(Array.from({ length: 12 }, (_, i) => file(`p${i}.jpg`, "image/jpeg", 1000 + i)));
    expect(screen.getByTestId("count").textContent).toBe("10");
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
