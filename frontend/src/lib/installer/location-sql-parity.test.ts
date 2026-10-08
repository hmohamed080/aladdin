import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "./location-data";
import { normalizePlace } from "./opportunity-location";

/**
 * ONE CATALOGUE, TWO READERS.
 *
 * The match score, the board's governorate / city filters and "Nearest" all resolve
 * a job's free-text place IN SQL (`app.resolve_governorate` / `app.resolve_city`,
 * backed by the `app.place_governorates` / `app.place_cities` reference tables),
 * while the UI offers the same places from `location-data.ts`. The SQL rows are
 * GENERATED from the TypeScript catalogue; this test fails the moment either side
 * changes without the other, so the two can never disagree about what counts as
 * "the same city".
 */

const MIGRATION = path.resolve(__dirname, "../../../../supabase/migrations/20261006090003_place_catalogue.sql");
const sql = readFileSync(MIGRATION, "utf8");

const unquote = (s: string) => s.replace(/''/g, "'");

function section(from: string, to: string): string {
  const start = sql.indexOf(from);
  const end = sql.indexOf(to, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const q = "'((?:[^']|'')*)'";
const govBody = section("insert into app.place_governorates", "insert into app.place_cities");
const cityBody = section("insert into app.place_cities", "-- Reference data about places");

const sqlGovernorates = [...govBody.matchAll(new RegExp(`\\(${q}, ${q}\\)`, "g"))].map((m) => [unquote(m[1]!), unquote(m[2]!)]);
const sqlCities = [...cityBody.matchAll(new RegExp(`\\(${q}, ${q}, ${q}\\)`, "g"))].map((m) => [unquote(m[1]!), unquote(m[2]!), unquote(m[3]!)]);

describe("SQL place catalogue is generated from location-data.ts", () => {
  it("lists every governorate under its key, Arabic and English names — and nothing else", () => {
    const expected = GOVERNORATE_OPTIONS.flatMap((g) => [g.value, g.ar, g.en].map((name) => [g.value, name]));
    expect(sqlGovernorates).toEqual(expected);
  });

  it("lists every city, inside its own governorate, under its key, Arabic and English names — and nothing else", () => {
    const expected = Object.entries(CITIES_BY_GOVERNORATE).flatMap(([gov, cities]) =>
      cities.flatMap((c) => [c.value, c.ar, c.en].map((name) => [gov, c.value, name])),
    );
    expect(sqlCities).toEqual(expected);
  });

  it("every catalogue name normalises to a non-empty, distinct-per-place key (so SQL cannot collide where TS does not)", () => {
    const seen = new Map<string, string>();
    for (const [key, name] of sqlGovernorates) {
      const n = normalizePlace(name!);
      expect(n).not.toBe("");
      expect(seen.get(n) ?? key).toBe(key);
      seen.set(n, key!);
    }
  });

  it("the SQL normaliser applies the same lossless steps as normalizePlace", () => {
    const body = section("create function app.normalize_place", "create table app.place_governorates");
    expect(body).toContain("nfkc");
    expect(body).toContain("\\u064B-\\u065F\\u0670\\u0640");
    expect(body).toContain("lower(btrim(");
  });
});
