import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";

const actions = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/server/actions/upload-allowances", () => ({
  saveUploadAllowancesAction: vi.fn(),
  addUploadExemptionAction: vi.fn(),
  removeUploadExemptionAction: vi.fn(),
  searchUploadSubjectsAction: actions.search,
}));

import { parseUploadLimits } from "@/lib/media/upload-allowances";
import { UploadAllowances } from "./upload-allowances";

const data = parseUploadLimits({
  settings: { hourly_uploads: 50, hourly_attempts: 150, storage_quota_mb: 1024 },
  exemptions: [{ id: "e1", subject_type: "organization", label: "Nile Showroom", reason: "bulk catalogue", created_at: "" }],
})!;

describe("upload allowances", () => {
  it("shows the saved numbers and finds an account to exempt", async () => {
    actions.search.mockResolvedValue({ ok: true, subjects: [{ type: "user", id: "11111111-1111-4111-8111-111111111111", label: "Mona", detail: "engineer" }] });
    renderWithI18n(<UploadAllowances data={data} canManage />, "en");
    expect(screen.getByLabelText("Attempts per hour (failed ones included)")).toHaveValue("150");
    expect(screen.getByRole("button", { name: "Remove exemption" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find an account"), { target: { value: "Mona" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Mona/ })).toBeInTheDocument());
    expect(actions.search).toHaveBeenCalledWith("Mona");
  });

  it("is read only without the manage permission", () => {
    renderWithI18n(<UploadAllowances data={data} canManage={false} />, "en");
    expect(screen.getByText("Nile Showroom")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("refuses an answer without settings", () => {
    expect(parseUploadLimits({})).toBeNull();
  });
});
