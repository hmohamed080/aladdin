import { describe, expect, it } from "vitest";
import { BODY_MAX, TITLE_MAX, templateVariables, validateTemplateTexts } from "./templates";

const ok = { titleAr: "عنوان", bodyAr: "نص {message}", titleEn: "Title", bodyEn: "Body {message}" };

describe("templateVariables", () => {
  it("lists each variable once, sorted", () => {
    expect(templateVariables("{b} and {a} and {b}")).toEqual(["a", "b"]);
  });
  it("ignores braces that are not a variable", () => {
    expect(templateVariables("{} { x } {a-b} {اسم}")).toEqual([]);
  });
});

describe("validateTemplateTexts", () => {
  it("accepts declared variables in every text", () => {
    expect(validateTemplateTexts(ok, ["message"])).toEqual({ ok: true });
  });
  it("names an undeclared variable, in any language", () => {
    expect(validateTemplateTexts({ ...ok, bodyEn: "Body {secret}" }, ["message"])).toEqual({ ok: false, code: "variable", detail: ["secret"] });
    expect(validateTemplateTexts({ ...ok, titleAr: "{x}" }, ["message"])).toMatchObject({ ok: false, code: "variable", detail: ["x"] });
  });
  it("refuses an empty or blank text", () => {
    expect(validateTemplateTexts({ ...ok, titleEn: "   " }, ["message"])).toEqual({ ok: false, code: "length" });
  });
  it("enforces the title and body limits", () => {
    expect(validateTemplateTexts({ ...ok, titleAr: "x".repeat(TITLE_MAX + 1) }, ["message"])).toEqual({ ok: false, code: "length" });
    expect(validateTemplateTexts({ ...ok, bodyAr: "x".repeat(BODY_MAX + 1) }, ["message"])).toEqual({ ok: false, code: "length" });
    expect(validateTemplateTexts({ ...ok, bodyAr: "x".repeat(BODY_MAX) }, ["message"])).toEqual({ ok: true });
  });
});
