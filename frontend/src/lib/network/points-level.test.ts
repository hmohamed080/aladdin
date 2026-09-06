import { describe, expect, it } from "vitest";
import { derivePointsLevel } from "./points-level";

describe("derivePointsLevel", () => {
  it("0 -> level 1, 100 remaining", () => {
    expect(derivePointsLevel(0)).toMatchObject({ level: 1, isMaxLevel: false, remainingToNextLevel: 100 });
  });
  it("99 -> level 1, 1 remaining", () => {
    expect(derivePointsLevel(99)).toMatchObject({ level: 1, isMaxLevel: false, remainingToNextLevel: 1 });
  });
  it("100 -> level 2, 150 remaining", () => {
    expect(derivePointsLevel(100)).toMatchObject({ level: 2, isMaxLevel: false, remainingToNextLevel: 150 });
  });
  it("249 -> level 2, 1 remaining", () => {
    expect(derivePointsLevel(249)).toMatchObject({ level: 2, isMaxLevel: false, remainingToNextLevel: 1 });
  });
  it("250 -> level 3, 250 remaining", () => {
    expect(derivePointsLevel(250)).toMatchObject({ level: 3, isMaxLevel: false, remainingToNextLevel: 250 });
  });
  it("350 -> level 3, 150 remaining", () => {
    expect(derivePointsLevel(350)).toMatchObject({ level: 3, isMaxLevel: false, remainingToNextLevel: 150 });
  });
  it("500 -> level 4, 500 remaining", () => {
    expect(derivePointsLevel(500)).toMatchObject({ level: 4, isMaxLevel: false, remainingToNextLevel: 500 });
  });
  it("999 -> level 4, 1 remaining", () => {
    expect(derivePointsLevel(999)).toMatchObject({ level: 4, isMaxLevel: false, remainingToNextLevel: 1 });
  });
  it("1000 -> level 5, highest level, no remaining", () => {
    expect(derivePointsLevel(1000)).toMatchObject({ level: 5, isMaxLevel: true, remainingToNextLevel: null });
  });
  it("well past 1000 stays at level 5 — no level 6 is invented", () => {
    expect(derivePointsLevel(50000)).toMatchObject({ level: 5, isMaxLevel: true, remainingToNextLevel: null });
  });
  it("a negative (corrected) balance still resolves to level 1, never a negative level", () => {
    expect(derivePointsLevel(-40)).toMatchObject({ level: 1, isMaxLevel: false });
  });
  it("progress climbs within a level's own band and reaches 100 at the max level", () => {
    expect(derivePointsLevel(0).progressPct).toBe(0);
    expect(derivePointsLevel(1000).progressPct).toBe(100);
    expect(derivePointsLevel(50000).progressPct).toBe(100);
  });
});
