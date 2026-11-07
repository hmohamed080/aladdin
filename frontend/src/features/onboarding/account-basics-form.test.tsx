import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";

vi.mock("@/server/actions/account-basics", () => ({ saveAccountBasics: vi.fn() }));

import { AccountBasicsForm } from "./account-basics-form";
import type { SpecialtySource } from "./basics-fields";

const ALL = { phone: true, location: true, specialties: true };
const TRADES: SpecialtySource = { kind: "trades", keys: ["wallpaper_installation", "door_installation"] };
const continueButton = () => screen.getByRole("button", { name: en.accountBasics.submit }) as HTMLButtonElement;

describe("AccountBasicsForm", () => {
  it("asks one question per step, phone first, with the onboarding progress", () => {
    renderWithI18n(<AccountBasicsForm missing={ALL} source={TRADES} next="/home" />, "en");
    expect(screen.getByRole("heading", { name: en.accountBasics.phoneLabel })).toBeInTheDocument();
    expect(screen.getByText(en.onboarding.stepLabel.replace("{current}", "1").replace("{total}", "3"))).toBeInTheDocument();
    expect(continueButton().disabled).toBe(true);
  });

  it("leaves out the steps the account already completed", () => {
    renderWithI18n(<AccountBasicsForm missing={{ phone: false, location: false, specialties: true }} source={TRADES} next="/home" />, "en");
    expect(document.querySelector('input[name="phone"]')).toBeNull();
    expect(document.querySelector('select[name="governorate"]')).toBeNull();
    expect(screen.getByRole("heading", { name: en.accountBasics.specialtiesLabel })).toBeInTheDocument();
    expect(screen.getByText(en.onboarding.stepLabel.replace("{current}", "1").replace("{total}", "1"))).toBeInTheDocument();
  });

  it("moves from location to specialties, and submits picked specialties in order", () => {
    renderWithI18n(<AccountBasicsForm missing={{ phone: false, location: true, specialties: true }} source={TRADES} next="/home" />, "en");
    expect(screen.getByRole("heading", { name: en.accountBasics.locationLabel })).toBeInTheDocument();
    const city = screen.getByLabelText(en.accountBasics.cityLabel) as HTMLSelectElement;
    expect(city.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(en.accountBasics.governorateLabel), { target: { value: "cairo" } });
    expect(city.disabled).toBe(false);
    expect(Array.from(city.options).some((o) => o.value === "new-cairo")).toBe(true);
    fireEvent.change(city, { target: { value: "__other__" } });
    expect(screen.getByLabelText(en.accountBasics.cityCustomLabel)).toBeInTheDocument();
    expect((document.querySelector('input[type=hidden][name="city"]') as HTMLInputElement).value).toBe("");
    expect(continueButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(en.accountBasics.cityCustomLabel), { target: { value: "El Rehab" } });
    fireEvent.click(continueButton());

    expect(screen.getByRole("heading", { name: en.accountBasics.specialtiesLabel })).toBeInTheDocument();
    const add = screen.getByLabelText(en.accountBasics.specialtiesAdd) as HTMLSelectElement;
    fireEvent.change(add, { target: { value: "door_installation" } });
    fireEvent.change(add, { target: { value: "wallpaper_installation" } });
    const picked = () => Array.from(document.querySelectorAll('input[type=hidden][name="specialties"]')).map((i) => (i as HTMLInputElement).value);
    expect(picked()).toEqual(["door_installation", "wallpaper_installation"]);
    const door = en.onboarding.professional.specializations.door_installation;
    expect(screen.getByText(`${door} · ${en.accountBasics.main}`)).toBeInTheDocument();
    // A picked specialty leaves the dropdown; when all are picked it is disabled.
    expect(Array.from(add.options).map((o) => o.value)).toEqual([""]);
    expect(add.disabled).toBe(true);

    // Removing the main one makes the next one main.
    fireEvent.click(screen.getByRole("button", { name: en.accountBasics.specialtiesRemove.replace("{name}", door) }));
    expect(picked()).toEqual(["wallpaper_installation"]);
    expect(screen.getByText(`${en.onboarding.professional.specializations.wallpaper_installation} · ${en.accountBasics.main}`)).toBeInTheDocument();
    expect(add.disabled).toBe(false);

    // Back keeps the answers of the earlier step.
    fireEvent.click(screen.getByRole("button", { name: en.onboarding.back }));
    expect((screen.getByLabelText(en.accountBasics.cityCustomLabel) as HTMLInputElement).value).toBe("El Rehab");
  });

  it("offers an Engineer the Engineer list, in the page language", () => {
    const source: SpecialtySource = { kind: "activities", keys: ["civil_engineer", "architect"] };
    renderWithI18n(<AccountBasicsForm missing={{ phone: false, location: false, specialties: true }} source={source} next="/home" />, "ar");
    const add = document.getElementById("specialtyAdd") as HTMLSelectElement;
    expect(Array.from(add.options).map((o) => o.textContent).slice(1)).toEqual(["مهندس مدني", "مهندس معماري"]);
    expect(document.body.textContent).not.toContain("تركيب ورق حائط");
  });
});
