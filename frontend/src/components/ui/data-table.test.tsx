import { describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render";
import { DataTable, RecordCell } from "./data-table";

/**
 * The list primitive's direction rule.
 *
 * A visual review in the Arabic workspace found an English job title rendering
 * as `…aircase cladding - Fifth Settlement`. The cause is not a bug in
 * `text-overflow`: an LTR string inside an RTL container inherits RTL, so the
 * ellipsis is placed at what the CONTAINER thinks is the end and the reader
 * loses the words that identify the record.
 *
 * `dir="auto"` resolves direction per value from its first strong character, so
 * the fix is invisible to Arabic content and to the whole LTR workspace. It
 * lives on the primitive rather than on the Jobs list because every record list
 * in this product renders user-entered text through `RecordCell`.
 */
describe("RecordCell direction", () => {
  it("lets a user-entered title resolve its own direction", () => {
    const { container } = renderWithI18n(
      <RecordCell title="Marble staircase cladding - Fifth Settlement" />,
      "ar",
    );
    const title = container.querySelector(".truncate");
    expect(title?.getAttribute("dir")).toBe("auto");
  });

  it("does the same for the supporting line, which is user-entered too", () => {
    const { container } = renderWithI18n(
      <RecordCell title="A job" meta="Horizon Contracting · Marble & granite" />,
      "ar",
    );
    const lines = [...container.querySelectorAll(".truncate")];
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.getAttribute("dir") === "auto")).toBe(true);
  });

  /**
   * The rule must not be conditional on the workspace locale — the same cell
   * renders in both, and a component that branched on locale would be exactly
   * the "Arabic-only rule in a component" the UI contract forbids (R5).
   */
  it("applies the same rule in the LTR workspace", () => {
    const { container } = renderWithI18n(<RecordCell title="A job" meta="An org" />, "en");
    for (const line of container.querySelectorAll(".truncate")) {
      expect(line.getAttribute("dir")).toBe("auto");
    }
  });

  it("still renders the title as a link when one is given", () => {
    const { container } = renderWithI18n(
      <RecordCell title="A job" href="/somewhere" />,
      "en",
    );
    expect(container.querySelector('a[href="/somewhere"]')).toBeTruthy();
    expect(container.querySelector('a .truncate')?.getAttribute("dir")).toBe("auto");
  });
});

describe("DataTable", () => {
  const rows = [{ id: "1", name: "One" }];

  it("renders the lead column in both the table and the mobile card", () => {
    const { container } = renderWithI18n(
      <DataTable
        caption="things"
        rows={rows}
        rowKey={(r) => r.id}
        empty={<p>none</p>}
        columns={[
          { key: "name", header: "Name", cell: (r) => <RecordCell title={r.name} /> },
          { key: "x", header: "X", cell: () => "x" },
        ]}
      />,
      "en",
    );
    // Once in the table body, once in the card list.
    expect(container.textContent?.match(/One/g)?.length).toBe(2);
  });

  it("shows the empty node instead of a header-only table", () => {
    const { container } = renderWithI18n(
      <DataTable
        caption="things"
        rows={[]}
        rowKey={(r: { id: string }) => r.id}
        empty={<p>none</p>}
        columns={[{ key: "name", header: "Name", cell: () => "x" }]}
      />,
      "en",
    );
    expect(container.textContent).toBe("none");
    expect(container.querySelector("table")).toBeNull();
  });
});
