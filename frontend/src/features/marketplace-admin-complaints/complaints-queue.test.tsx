import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { ComplaintsQueue } from "./complaints-queue";
import type { ComplaintList } from "./model";

const list: ComplaintList = {
  total: 1,
  counts: { open: 1, under_review: 2, resolved: 0, dismissed: 3 },
  items: [{ id: "k1", order_id: "o1", order_number: "MP-000042", state: "open", reason: "amount_mismatch", filed_by_role: "seller",
    seller_name: "Decore", buyer_name: "Test Buyer", total_egp: 500, paid_now_egp: 500, filed_at: "2026-12-01T10:00:00Z", receipts_count: 2 }],
};

describe("ComplaintsQueue", () => {
  it("lists the complaint with a link to its page and the counts on the tabs", () => {
    render(<ComplaintsQueue list={list} active="open" locale="en" t={createTranslator("en")} basePath="/admin/marketplace/payment-complaints" />);
    expect(screen.getByRole("link", { name: "MP-000042" }).getAttribute("href")).toBe("/admin/marketplace/payment-complaints/k1");
    expect(screen.getByText("The amount does not match")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Under review \(2\)/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open \(1\)/ }).getAttribute("aria-current")).toBe("page");
  });
  it("shows an empty state, in Arabic", () => {
    render(<ComplaintsQueue list={{ ...list, total: 0, items: [] }} active="resolved" locale="ar" t={createTranslator("ar")} basePath="/x" />);
    expect(screen.getByText("لا توجد شكاوى في هذه القائمة.")).toBeTruthy();
  });
});
