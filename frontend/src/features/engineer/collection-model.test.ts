import { describe, expect, it } from "vitest";
import { collectionChangeSchema } from "./collection-model";
const id = "70000010-0000-4000-8000-000000000010";
describe("collection mutation boundary", () => {
  it("rejects incomplete or invalid mutation targets", () => {
    for (const value of [
      { action: "save" },
      { action: "delete_team" },
      { action: "create_team", name: "  " },
      { action: "save", entityType: "users", entityId: id },
      {
        action: "remove",
        collectionId: "not-a-uuid",
        entityId: id,
        entityType: "profile",
      },
    ])
      expect(collectionChangeSchema.safeParse(value).success).toBe(false);
  });
  it("trims team names and accepts a complete saved entity", () => {
    expect(
      collectionChangeSchema.parse({
        action: "create_team",
        name: "  Design team  ",
      }).name,
    ).toBe("Design team");
    expect(
      collectionChangeSchema.safeParse({
        action: "save",
        entityType: "profile",
        entityId: id,
      }).success,
    ).toBe(true);
  });
});
