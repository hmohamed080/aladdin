"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input, Select } from "@/components/ui/controls";
import { HeartIcon, PlusIcon } from "@/components/ui/icons";
import { changeEngineerCollection } from "@/server/actions/engineer-collections";
import type { CollectionEntity } from "./collection-model";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteTeam({ teamId }: { teamId: string }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const label = ar ? "حذف الفريق" : "Delete team";
  return (
    <ConfirmDialog
      trigger={label}
      title={label}
      confirmLabel={label}
      body={
        ar
          ? "سيتم حذف قائمتك الخاصة وأعضائها المحفوظين."
          : "This removes your private roster and its saved members."
      }
      formAction={async () => {
        try {
          return await changeEngineerCollection({
            action: "delete_team",
            collectionId: teamId,
          });
        } catch {
          return { ok: false, code: "states.genericRetry" };
        }
      }}
    />
  );
}

export function CollectionButton({
  entityId,
  entityType,
  saved = false,
  collectionId,
}: {
  entityId: string;
  entityType: CollectionEntity;
  saved?: boolean;
  collectionId?: string;
}) {
  const { locale, t } = useI18n();
  const ar = locale === "ar";
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={saved}
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await changeEngineerCollection({
                action: collectionId ? "remove" : saved ? "unsave" : "save",
                collectionId,
                entityId,
                entityType,
              });
              if (!r.ok) setError(t(r.code ?? "states.genericRetry"));
              else router.refresh();
            } catch {
              setError(t("states.genericRetry"));
            }
          })
        }
      >
        <HeartIcon size={17} />
        {collectionId
          ? ar
            ? "إزالة"
            : "Remove"
          : saved
            ? ar
              ? "محفوظ"
              : "Saved"
            : ar
              ? "حفظ"
              : "Save"}
      </Button>
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TeamEditor({
  teamId,
  profiles,
}: {
  teamId?: string;
  profiles?: { id: string; name: string }[];
}) {
  const { locale, t } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          try {
            const r = await changeEngineerCollection(
              teamId
                ? {
                    action: "add",
                    collectionId: teamId,
                    entityType: "profile",
                    entityId: value,
                  }
                : { action: "create_team", name: value },
            );
            if (!r.ok) setError(t(r.code ?? "states.genericRetry"));
            else {
              setValue("");
              setError("");
              router.refresh();
            }
          } catch {
            setError(t("states.genericRetry"));
          }
        });
      }}
    >
      <label className="text-label">
        {teamId
          ? ar
            ? "إضافة متخصص للفريق"
            : "Add a professional"
          : ar
            ? "اسم فريق العمل"
            : "Team name"}
        {teamId ? (
          <Select
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2"
          >
            <option value="">
              {ar ? "اختر متخصصاً" : "Choose a professional"}
            </option>
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            required
            maxLength={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2"
          />
        )}
      </label>
      <Button disabled={pending} type="submit" variant="outline">
        <PlusIcon size={16} />
        {teamId ? (ar ? "إضافة" : "Add") : ar ? "إنشاء فريق" : "Create team"}
      </Button>
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
