import { describe, expect, it } from "vitest";
import { ACCOUNT_VIEWS, viewAsBasePath, viewKindForAccountType } from "./registry";

describe("account view registry", () => {
  it("registers Craftsman only (Showroom is a later entry, not a framework change)", () => {
    expect(Object.keys(ACCOUNT_VIEWS)).toEqual(["craftsman"]);
  });
  it("maps the installer persona to the craftsman view and nothing else", () => {
    expect(viewKindForAccountType("installer_technician")).toBe("craftsman");
    for (const t of ["end_consumer", "engineer", "contractor", "sales", "showroom_dealer", "", null, undefined]) {
      expect(viewKindForAccountType(t)).toBeNull();
    }
  });
  it("builds one base path under the admin user route", () => {
    expect(viewAsBasePath("abc")).toBe("/admin/users/abc/view");
  });
});
