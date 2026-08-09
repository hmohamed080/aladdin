import { describe, expect, it } from "vitest";
import { mapExecutionError } from "@/server/actions/error-mapping";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/** Resolve a dotted key against a message catalog, or undefined if missing. */
function resolve(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe("mapExecutionError", () => {
  it("maps optimistic-concurrency conflicts", () => {
    expect(mapExecutionError({ code: "40001" })).toBe("execution.errors.conflict");
    expect(mapExecutionError({ message: "order was modified concurrently" })).toBe(
      "execution.errors.conflict",
    );
  });

  it("maps the 'exactly one' invariants", () => {
    expect(mapExecutionError({ message: "an order already exists for this quotation" })).toBe(
      "execution.errors.orderExists",
    );
    expect(mapExecutionError({ message: "a project already exists for this order" })).toBe(
      "execution.errors.projectExists",
    );
  });

  it("maps lifecycle-gate errors", () => {
    expect(
      mapExecutionError({ message: "an order can only be created from an accepted quotation" }),
    ).toBe("execution.errors.notAccepted");
    expect(mapExecutionError({ message: "only an in-progress order can start a project" })).toBe(
      "execution.errors.orderNotStarted",
    );
    expect(mapExecutionError({ message: "only a confirmed order can be started" })).toBe(
      "execution.errors.orderNotConfirmed",
    );
    expect(mapExecutionError({ message: "only a planned project can be activated" })).toBe(
      "execution.errors.projectNotPlanned",
    );
    expect(mapExecutionError({ message: "only an active project can be completed" })).toBe(
      "execution.errors.projectNotActive",
    );
  });

  it("maps a generic permission denial and an unknown fallback", () => {
    expect(mapExecutionError({ code: "42501", message: "order.manage required" })).toBe(
      "execution.errors.denied",
    );
    expect(mapExecutionError({ message: "connection reset" })).toBe("states.genericRetry");
    expect(mapExecutionError(null)).toBe("states.genericRetry");
  });

  it("only ever returns keys that exist in BOTH message catalogs", () => {
    const samples = [
      { code: "40001" },
      { message: "an order already exists for this quotation" },
      { message: "a project already exists for this order" },
      { message: "an order can only be created from an accepted quotation" },
      { message: "only an in-progress order can start a project" },
      { message: "only a confirmed order can be started" },
      { message: "only a confirmed order can be cancelled" },
      { message: "only a planned project can be activated" },
      { message: "only an active project can be completed" },
      { code: "42501" },
      { message: "unknown" },
    ];
    for (const e of samples) {
      const key = mapExecutionError(e);
      expect(typeof resolve(en, key), `en missing ${key}`).toBe("string");
      expect(typeof resolve(ar, key), `ar missing ${key}`).toBe("string");
    }
  });
});

describe("execution enums have full bilingual label coverage", () => {
  const ORDER_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"];
  const PROJECT_STATUSES = ["planned", "active", "completed"];

  it("every order + project status has an en + ar label", () => {
    for (const s of ORDER_STATUSES) {
      expect(typeof resolve(en, `execution.orderStatus.${s}`), `en order ${s}`).toBe("string");
      expect(typeof resolve(ar, `execution.orderStatus.${s}`), `ar order ${s}`).toBe("string");
    }
    for (const s of PROJECT_STATUSES) {
      expect(typeof resolve(en, `execution.projectStatus.${s}`), `en project ${s}`).toBe("string");
      expect(typeof resolve(ar, `execution.projectStatus.${s}`), `ar project ${s}`).toBe("string");
    }
  });
});
