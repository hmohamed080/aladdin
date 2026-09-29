import { describe, expect, it } from "vitest";
import { classifyAdminDate, classifyAdminTime, maskAdminTime, formatAdminDateInput, maskAdminDate, parseAdminDate, toAsciiDigits } from "./date-input";

describe("maskAdminDate", () => {
  it("inserts slashes as digits are typed", () => {
    expect(maskAdminDate("2")).toBe("2");
    expect(maskAdminDate("29")).toBe("29");
    expect(maskAdminDate("290")).toBe("29/0");
    expect(maskAdminDate("29092026")).toBe("29/09/2026");
  });
  it("ignores non-digits and caps at 8 digits", () => {
    expect(maskAdminDate("29/09/2026999")).toBe("29/09/2026");
    expect(maskAdminDate("ab1c2")).toBe("12");
  });
  it("accepts Arabic-Indic digits", () => {
    expect(maskAdminDate("٢٩٠٩٢٠٢٦")).toBe("29/09/2026");
    expect(toAsciiDigits("۱۲")).toBe("12");
  });
});

describe("parseAdminDate", () => {
  it("is DAY first: 09/10/2026 is 9 October, never 10 September", () => {
    expect(parseAdminDate("09/10/2026")).toBe("2026-10-09");
    expect(parseAdminDate("29/09/2026")).toBe("2026-09-29");
  });
  it("accepts one-digit day/month and other separators", () => {
    expect(parseAdminDate("1/2/2026")).toBe("2026-02-01");
    expect(parseAdminDate("01-02-2026")).toBe("2026-02-01");
  });
  it("rejects US-order and non-existent dates", () => {
    expect(parseAdminDate("09/29/2026")).toBeNull(); // month 29
    expect(parseAdminDate("31/02/2026")).toBeNull();
    expect(parseAdminDate("29/02/2026")).toBeNull(); // not a leap year
    expect(parseAdminDate("29/02/2028")).toBe("2028-02-29");
    expect(parseAdminDate("00/01/2026")).toBeNull();
    expect(parseAdminDate("junk")).toBeNull();
  });
});

describe("formatAdminDateInput", () => {
  it("renders ISO as DD/MM/YYYY", () => {
    expect(formatAdminDateInput("2026-09-05")).toBe("05/09/2026");
    expect(formatAdminDateInput("2026-09-05T10:00:00Z")).toBe("05/09/2026");
    expect(formatAdminDateInput("")).toBe("");
    expect(formatAdminDateInput(undefined)).toBe("");
  });
});

describe("classifyAdminDate", () => {
  it("distinguishes empty, incomplete, invalid, past-max and valid", () => {
    expect(classifyAdminDate("").status).toBe("empty");
    expect(classifyAdminDate("29/09").status).toBe("incomplete");
    expect(classifyAdminDate("31/02/2026").status).toBe("invalid");
    expect(classifyAdminDate("30/09/2026", "2026-09-29").status).toBe("afterMax");
    expect(classifyAdminDate("29/09/2026", "2026-09-29")).toEqual({ status: "valid", iso: "2026-09-29" });
  });
});

describe("24-hour time", () => {
  it("masks digits into HH:mm", () => {
    expect(maskAdminTime("1")).toBe("1");
    expect(maskAdminTime("143")).toBe("14:3");
    expect(maskAdminTime("1430")).toBe("14:30");
    expect(maskAdminTime("١٤٣٠")).toBe("14:30");
  });
  it("rejects 24+ hours and 60+ minutes, never AM/PM", () => {
    expect(classifyAdminTime("")).toBe("empty");
    expect(classifyAdminTime("14")).toBe("incomplete");
    expect(classifyAdminTime("14:30")).toBe("valid");
    expect(classifyAdminTime("24:00")).toBe("invalid");
    expect(classifyAdminTime("12:75")).toBe("invalid");
  });
});
