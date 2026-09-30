import { describe, it, expect } from "vitest";
import {
  pageWindow,
  parseOrgsDirectoryParams,
  parsePage,
  parseSearch,
  parseUsersDirectoryParams,
  SEARCH_MAX_LENGTH,
} from "./directory-params";

describe("parseUsersDirectoryParams", () => {
  it("defaults to page 1, 10 rows, Registered newest first, no filters", () => {
    expect(parseUsersDirectoryParams({})).toEqual({
      search: null,
      status: null,
      accountType: null,
      verification: null,
      governorate: null,
      sort: "registered:desc",
      page: 1,
      pageSize: 10,
    });
  });

  it("passes every valid value through unchanged", () => {
    expect(
      parseUsersDirectoryParams({
        q: "  Hana  ",
        status: "suspended",
        type: "engineer",
        verification: "rejected",
        governorate: "giza",
        sort: "completeness:asc",
        page: "21",
        pageSize: "25",
      }),
    ).toEqual({
      search: "Hana",
      status: "suspended",
      accountType: "engineer",
      verification: "rejected",
      governorate: "giza",
      sort: "completeness:asc",
      page: 21,
      pageSize: 25,
    });
  });

  it("turns an invalid page into page 1", () => {
    for (const bad of ["0", "-3", "abc", "2.5", "1e3", "", "99999999999999999999"]) {
      expect(parseUsersDirectoryParams({ page: bad }).page, bad).toBe(1);
    }
  });

  it("turns an unapproved page size into the default 10", () => {
    expect(parseUsersDirectoryParams({ pageSize: "7" }).pageSize).toBe(10);
    expect(parseUsersDirectoryParams({ pageSize: "1000" }).pageSize).toBe(10);
    expect(parseUsersDirectoryParams({ pageSize: "100" }).pageSize).toBe(100);
  });

  it("turns an unknown sort into the default, never another column's sort", () => {
    expect(parseUsersDirectoryParams({ sort: "name:asc" }).sort).toBe("registered:desc");
    expect(parseUsersDirectoryParams({ sort: "completeness" }).sort).toBe("registered:desc");
    expect(parseUsersDirectoryParams({ sort: "registered:sideways" }).sort).toBe("registered:desc");
  });

  it("drops unknown filter values instead of forwarding them", () => {
    const p = parseUsersDirectoryParams({ status: "deleted", type: "wizard", verification: "maybe", governorate: "atlantis" });
    expect(p).toMatchObject({ status: null, accountType: null, verification: null, governorate: null });
  });

  it("does not accept a business classification as a persona filter", () => {
    expect(parseUsersDirectoryParams({ type: "showroom_dealer" }).accountType).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseUsersDirectoryParams({ status: ["pending", "suspended"], page: ["3", "9"] })).toMatchObject({ status: "pending", page: 3 });
  });
});

describe("parseOrgsDirectoryParams", () => {
  it("accepts only the organization status tabs, types and sorts", () => {
    expect(parseOrgsDirectoryParams({ status: "rejected", type: "importer", sort: "completeness:desc" })).toMatchObject({
      status: null,
      orgType: "importer",
      sort: "registered:desc",
    });
    expect(parseOrgsDirectoryParams({ status: "pending", sort: "registered:asc", page: "4" })).toMatchObject({
      status: "pending",
      sort: "registered:asc",
      page: 4,
    });
  });
});

describe("parseSearch / parsePage", () => {
  it("trims, drops blanks and caps the search at the database limit", () => {
    expect(parseSearch("   ")).toBeNull();
    expect(parseSearch(undefined)).toBeNull();
    expect(parseSearch("x".repeat(250))).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("keeps Arabic search text intact", () => {
    expect(parseSearch(" هناء منصور ")).toBe("هناء منصور");
  });

  it("parses only positive integers", () => {
    expect(parsePage("12")).toBe(12);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe("pageWindow", () => {
  it("describes a middle page of the full result set", () => {
    expect(pageWindow(213, 3, 10, 10)).toEqual({ page: 3, totalPages: 22, total: 213, from: 21, to: 30 });
  });

  it("describes the partial last page", () => {
    expect(pageWindow(213, 22, 10, 3)).toEqual({ page: 22, totalPages: 22, total: 213, from: 211, to: 213 });
  });

  it("describes an empty result without a negative range", () => {
    expect(pageWindow(0, 1, 10, 0)).toEqual({ page: 1, totalPages: 1, total: 0, from: 0, to: 0 });
  });
});
