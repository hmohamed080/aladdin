import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

/**
 * THE UI FOUNDATION, as properties rather than as documentation.
 *
 * Everything here guards a failure that has ALREADY happened once in this
 * repository, which is the bar for putting a check in this file. A rule nobody
 * has broken is a comment; a rule that caught something is a test.
 */
describe("theme parity", () => {
  const tokens = read("src/styles/tokens.css");

  /**
   * Every semantic token defined for the light theme has a dark counterpart.
   *
   * The failure this catches is silent and total: a token defined only in the
   * light block resolves to nothing on a dark ground, so the component using it
   * renders one theme's ink on the other theme's surface — and it passes review
   * in whichever theme the reviewer happened to be in.
   */
  it("defines every LIGHT semantic token in the DARK block too", () => {
    const light = tokens.slice(
      tokens.indexOf("---- Semantics · LIGHT theme"),
      tokens.indexOf("---- Semantics · DARK theme"),
    );
    const dark = tokens.slice(tokens.indexOf("---- Semantics · DARK theme"));

    const names = (block: string) =>
      new Set(
        [...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)]
          .map((m) => m[1])
          .filter((v): v is string => typeof v === "string"),
      );

    const lightNames = names(light);
    const darkNames = names(dark);

    // Tokens that are deliberately theme-INDEPENDENT: one value serves both
    // grounds, and pairing them would be the bug.
    //
    //   --on-accent            Lumen is a bright amber in both themes and takes
    //                          dark ink on either.
    //   --workspace-pool-*     The atmosphere's pools alias fixed brand
    //                          primitives (navy-air, navy-edge, lumen) and are
    //                          `color-mix`ed INTO the mesh, which IS per-theme.
    //                          tokens.css states the intent directly: "the pools
    //                          keep their HUES … but the mesh they mix into is
    //                          dark". A dark override here would give the seam a
    //                          different hue from the sidebar it exists to echo.
    //
    // This list is the test's weak point and should stay short: every entry is a
    // property nobody is checking any more.
    const sharedByDesign = new Set([
      "--on-accent",
      "--workspace-pool-cool",
      "--workspace-pool-cool-2",
      "--workspace-pool-warm",
    ]);

    const missing = [...lightNames].filter((n) => !darkNames.has(n) && !sharedByDesign.has(n));
    expect(missing).toEqual([]);
  });

  it("defines --on-accent exactly once, as a shared value", () => {
    // The token exists because two components picked two different inks for the
    // same accent fill. A light/dark pair here would reintroduce the choice.
    expect([...tokens.matchAll(/^\s*--on-accent:/gm)].length).toBe(1);
  });
});

describe("ink on accent", () => {
  /**
   * Nothing paints a foreground on `bg-accent-solid` except `text-on-accent`.
   *
   * Before the token existed, `text-brand-basalt` (#0e1113) was used in four
   * places and `text-brand-lumen-ink` (#855a15) in two, on the same fill. That
   * is a visible difference nobody chose.
   */
  it("uses the semantic token and never a brand primitive", () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      if (!src.includes("bg-accent-solid")) return false;
      return /bg-accent-solid[^"'`]*text-brand-/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe("one app ground", () => {
  /**
   * Exactly one module may paint the application ground.
   *
   * The drift this closes: five layouts each wrote
   * `flex min-h-dvh flex-col bg-canvas` by hand. That string WAS the shell — an
   * unnamed one nobody could change centrally — and it is why a personal account
   * and a workspace read as different products.
   *
   * The remaining callers are the legacy surfaces named in the UI contract under
   * MIGRATE WHEN TOUCHED. This test pins the list so it can only shrink: a NEW
   * hand-written shell fails here, while the known ones are allowed to wait for
   * the surface that touches them.
   */
  it("holds the hand-written shell to its known legacy list", () => {
    // The EXACT flex-column shell string, and two qualifications on it:
    //
    //   * `className="` prefix, because several files DESCRIBE this pattern in a
    //     comment (the migration is documented where it happened) and a prose
    //     match would make the guard fire on its own explanation.
    //   * the full `flex … flex-col` form, because two other uses of
    //     `min-h-dvh bg-canvas` are legitimate and must NOT be caught: the root
    //     layout's `<body>`, which is the document ground and has to paint it,
    //     and `/auth`, a signed-out split-screen page that is deliberately
    //     outside the app shell entirely.
    const handRolled = FILES.filter((f) =>
      /className="flex min-h-dvh flex-col bg-canvas/.test(readFileSync(f, "utf8")),
    )
      .map((f) => f.replace(process.cwd(), "").split("\\").join("/"))
      .sort();

    expect(handRolled).toEqual([
      "/src/app/admin/layout.tsx",
      "/src/app/business/layout.tsx",
      "/src/app/onboarding/layout.tsx",
      // A standalone notice page rather than a shell, but it paints the same
      // ground by hand and migrates with the surfaces above.
      "/src/components/layout/no-org-notice.tsx",
    ]);
  });

  it("paints the frame and atmosphere in exactly one component", () => {
    const painters = FILES.filter((f) => /className="workspace-frame/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(/\\/g, "/"));
    expect(painters).toHaveLength(1);
    expect(painters[0] ?? "").toMatch(/app-shell\.tsx$/);
  });
});

describe("primary action", () => {
  /**
   * `PageHeader` renders the canonical Button rather than its own fill.
   *
   * This one mattered more than a page-level duplicate would: the hand-styled
   * link lived INSIDE the foundation, so every workspace module inherited a
   * second primary-button treatment and the divergence was invisible page by
   * page.
   */
  it("does not hand-style a primary action inside the foundation", () => {
    const layout = read("src/components/ui/workspace-layout.tsx");
    expect(layout).toMatch(/<Button type="button" variant="accent"/);
    // No inline accent fill on a Link anywhere in the file.
    expect(layout).not.toMatch(/<Link[\s\S]{0,200}bg-accent-solid/);
  });
});

describe("stored language values", () => {
  /**
   * A stored language code never reaches the screen as a translation key.
   *
   * `profiles.languages` holds two conventions — `arabic`/`english` from the
   * onboarding flow and ISO `ar`/`en` in every seeded row — and the onboarding
   * catalog only has keys for the first. Rendering a stored value through the
   * catalog printed `onboarding.professional.languages.ar` verbatim to the
   * account's own owner.
   *
   * The two remaining catalog call sites are CORRECT: they label selectable
   * choice chips whose keys come from the catalog itself and always resolve. So
   * this asserts the specific surfaces that render STORED values, not a
   * repo-wide ban.
   */
  it("renders stored languages through the normalizer on every display surface", () => {
    for (const f of [
      "src/features/home/professional-home.tsx",
      "src/features/profile/profile-hub.tsx",
      "src/features/profile/public-profile.tsx",
    ]) {
      const src = read(f);
      expect(src, `${f} must use languageLabel`).toMatch(/languageLabel\(t, /);
      expect(src, `${f} must not use the raw catalog`).not.toMatch(
        /t\(`onboarding\.professional\.languages\./,
      );
    }
  });

  it("leaves the onboarding CHOICE sites on the catalog", () => {
    for (const f of [
      "src/features/onboarding/professional-flow.tsx",
      "src/features/profile/professional-profile-editor.tsx",
    ]) {
      expect(read(f)).toMatch(/onboarding\.professional\.languages\./);
    }
  });
});

describe("navigation geometry", () => {
  /**
   * Every navigation mounted in the sidebar clamps itself to `--shell-nav-w`.
   *
   * The scrolling panel that holds the nav spans the sidebar INCLUDING its 14px
   * gutter, and has to: `overflow-y: auto` clips both axes, so a scroller sized
   * to the navy alone would sever the carve at exactly the edge it exists to
   * cross. The cost of that decision is that every nav inside it must hold
   * itself back. `PersonalSidebar` did not, and inherited the gutter — which
   * widened the row by 14px, moved the rail's centred icon 7px off the column
   * the carve is pinned to, and ran hover surfaces out onto the frame.
   *
   * Found in a browser, invisible to everything else: the rows were correct, the
   * links were correct, and the number that was wrong is not in this file or in
   * either component — it is `--shell-gutter-w`, three levels up.
   */
  it("holds every shell navigation to the nav column width", () => {
    const navs = FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      // `<nav` FOLLOWED BY WHITESPACE, so `sidebar-shell` itself is excluded:
      // it mentions `<nav>` in the comment explaining this very requirement.
      return /<nav\s/.test(src) && src.includes("useSidebarDisplay");
    });
    // Both fills of the shared shell: the workspace rail and the personal one.
    expect(navs.length).toBe(2);
    for (const f of navs) {
      expect(readFileSync(f, "utf8"), f).toMatch(/width: "var\(--shell-nav-w, ?100%\)"/);
    }
  });

  it("separates heading-less groups with one shared rule", () => {
    // Two lists draw a rule where a heading would go — the collapsed rail and
    // the personal nav. They wrote two different rules until this constant
    // existed; a second literal here is the drift coming back.
    for (const f of [
      "src/components/layout/workspace-nav.tsx",
      "src/components/layout/personal-nav.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/NAV_GROUP_SEPARATOR_CLASS/);
      expect(src, f).not.toMatch(/border-t border-shell-line/);
    }
  });
});

describe("server/client boundary", () => {
  /**
   * No layout hands a Client Component a function prop.
   *
   * THE MOST EXPENSIVE DEFECT OF THIS PASS. `SidebarShell` briefly took
   * `nav: (state) => ReactNode`, which reads better than a context and is
   * impossible: the shell is a Client Component, the layouts that mount it are
   * Server Components, and React cannot serialize a function across that
   * boundary. Both `/home` AND `/b2b` returned a 500 — while `tsc` accepted it,
   * `next build` compiled it, and all 33 shell tests passed, because a
   * client-side test render has no boundary to cross.
   *
   * Nothing in the normal validation path could see it. Only a real browser
   * could, which is why the guard is a crude string check rather than something
   * cleverer: the cost of missing it again is every authenticated page.
   */
  it("passes no render prop from a layout into the shell", () => {
    const norm = (f: string) => f.split("\\").join("/");
    const layouts = FILES.filter((f) => norm(f).includes("/app/") && f.endsWith("layout.tsx"));
    expect(layouts.length).toBeGreaterThan(0);
    const offenders = layouts
      .filter((f) => /(nav|header|footer|children)=\{\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => norm(f.replace(process.cwd(), "")));
    expect(offenders).toEqual([]);
  });

  it("keeps the shell's nav slot typed as a node, not a function", () => {
    const shell = read("src/components/layout/sidebar-shell.tsx");
    expect(shell).toMatch(/nav: ReactNode;/);
    // Comment lines excluded: this file EXPLAINS the old render prop at length,
    // and a naive text search makes the guard fire on its own rationale — the
    // same trap the hand-written-shell check above documents.
    const code = shell
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/nav: \(/);
  });
});
