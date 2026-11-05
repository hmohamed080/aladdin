import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOWROOM_GROUPS } from "./navigation";

/**
 * The structural guarantee behind a sidebar that does not reload.
 *
 * Next keeps a layout mounted only while the route segment that owns it stays on screen. The Showroom sidebar
 * links into two route trees, /showroom/* and /b2b/*; if they sit under DIFFERENT parent layouts, choosing a link
 * that crosses between them unmounts the shell and rebuilds it (the sidebar resets and scrolls back to the top,
 * every shell query runs again). They must therefore share one ancestor layout - the `(workspace)` route group.
 *
 * This test reads the file system on purpose: the regression it prevents is somebody moving a directory, which
 * no render test can see.
 */
const APP = join(process.cwd(), "src", "app");
const GROUP = join(APP, "(workspace)");

const treeOf = (href: string) => `/${href.split("?")[0]?.split("/")[1] ?? ""}`;

describe("Showroom navigation shares one persistent layout", () => {
  it("the (workspace) group owns a layout", () => {
    expect(existsSync(join(GROUP, "layout.tsx"))).toBe(true);
  });

  it("both trees the sidebar links into live inside that group", () => {
    expect(existsSync(join(GROUP, "b2b", "layout.tsx"))).toBe(true);
    expect(existsSync(join(GROUP, "showroom", "layout.tsx"))).toBe(true);
  });

  it("neither tree also exists OUTSIDE the group (that would split the layout again)", () => {
    expect(existsSync(join(APP, "b2b"))).toBe(false);
    expect(existsSync(join(APP, "showroom", "(app)"))).toBe(false);
  });

  it("the public Showroom sign-in/up pages stay outside the workspace shell", () => {
    const outside = readdirSync(join(APP, "showroom"));
    expect(outside).toEqual(expect.arrayContaining(["sign-in", "sign-up"]));
    expect(outside).not.toContain("home");
  });

  it("every sidebar destination is served from the shared group", () => {
    const trees = new Set(
      SHOWROOM_GROUPS.flatMap((group) => group.items.map((item) => treeOf(item.href))),
    );
    // Only these two trees may appear in the navigation; a third one would need its own place under the group.
    expect([...trees].sort()).toEqual(["/b2b", "/showroom"]);
    for (const tree of trees) expect(existsSync(join(GROUP, tree.slice(1)))).toBe(true);
  });
});
