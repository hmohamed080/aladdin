import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";

vi.mock("@/server/actions/account-basics", () => ({ saveAccountBasics: vi.fn() }));

import { AccountBasicsForm } from "./account-basics-form";

const ALL = { phone: true, location: true, specialties: true };

describe("AccountBasicsForm", () => {
  it("asks phone, then location, then specialties", () => {
    renderWithI18n(<AccountBasicsForm missing={ALL} tradeKeys={["wallpaper_installation", "door_installation"]} next="/home" />, "en");
    const text = document.body.textContent ?? "";
    const order = [en.accountBasics.phoneLabel, en.accountBasics.locationLabel, en.accountBasics.specialtiesLabel].map((l) => text.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByRole("heading", { name: en.accountBasics.title })).toBeInTheDocument();
  });

  it("renders only the sections still missing", () => {
    renderWithI18n(<AccountBasicsForm missing={{ phone: false, location: false, specialties: true }} tradeKeys={["wallpaper_installation"]} next="/home" />, "en");
    expect(document.querySelector('input[name="phone"]')).toBeNull();
    expect(document.querySelector('select[name="governorate"]')).toBeNull();
    expect(screen.getByText(en.accountBasics.specialtiesLabel)).toBeInTheDocument();
  });

  it("unlocks towns for the chosen governorate, offers Other, and submits picked specialties in order", () => {
    renderWithI18n(<AccountBasicsForm missing={ALL} tradeKeys={["wallpaper_installation", "door_installation"]} next="/home" />, "en");
    const city = screen.getByLabelText(en.accountBasics.cityLabel) as HTMLSelectElement;
    expect(city.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(en.accountBasics.governorateLabel), { target: { value: "cairo" } });
    expect(city.disabled).toBe(false);
    expect(Array.from(city.options).some((o) => o.value === "new-cairo")).toBe(true);
    fireEvent.change(city, { target: { value: "__other__" } });
    expect(screen.getByLabelText(en.accountBasics.cityCustomLabel)).toBeInTheDocument();
    expect((document.querySelector('input[type=hidden][name="city"]') as HTMLInputElement).value).toBe("");

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
  });
});
