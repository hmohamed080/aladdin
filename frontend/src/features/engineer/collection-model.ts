import { z } from "zod";
export const entityTypeSchema = z.enum([
  "profile",
  "organization",
  "product",
  "portfolio",
]);
export type CollectionEntity = z.infer<typeof entityTypeSchema>;
export const collectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["saved", "team"]),
  entries: z.array(z.object({ type: entityTypeSchema, id: z.string().uuid() })),
});
export type EngineerCollection = z.infer<typeof collectionSchema>;
export const collectionChangeSchema = z
  .object({
    action: z.enum([
      "save",
      "unsave",
      "add",
      "remove",
      "create_team",
      "delete_team",
    ]),
    collectionId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    entityType: entityTypeSchema.optional(),
    entityId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "create_team" && !value.name)
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Name required",
      });
    if (
      ["add", "remove", "delete_team"].includes(value.action) &&
      !value.collectionId
    )
      ctx.addIssue({
        code: "custom",
        path: ["collectionId"],
        message: "Collection required",
      });
    if (
      ["save", "unsave", "add", "remove"].includes(value.action) &&
      (!value.entityId || !value.entityType)
    )
      ctx.addIssue({
        code: "custom",
        path: ["entityId"],
        message: "Entry required",
      });
  });
