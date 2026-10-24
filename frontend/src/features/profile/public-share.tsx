"use client";
import { useState } from "react";
import { Button } from "@/components/ui/controls";
import { CopyIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";

export function PublicShare({ profileId, locale }: { profileId: string; locale: Locale }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const [publicUrl, setPublicUrl] = useState("");
  const ar = locale === "ar";
  return <div className="public-share"><Button variant="outline" onClick={async () => {
    const path = /^\/p\/[a-z][a-z_]+\/[a-z][a-z0-9._]*$/.test(window.location.pathname)
      ? window.location.pathname : `/p/${encodeURIComponent(profileId)}`;
    const url = `${window.location.origin}${path}`;
    setPublicUrl(url);
    try {
      // Share only the public route, never query parameters or a session URL.
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch { setState("error"); }
  }}><CopyIcon size={18} />{ar ? "نسخ رابط الملف" : "Copy profile link"}</Button><span role="status">{state === "copied" ? (ar ? "تم نسخ الرابط" : "Link copied") : state === "error" ? (ar ? "تعذر النسخ التلقائي. حدّد الرابط التالي لنسخه." : "Automatic copy failed. Select the link below to copy it.") : ""}</span>{state === "error" && <input aria-label={ar ? "رابط الملف العام" : "Public profile link"} readOnly dir="ltr" value={publicUrl} onFocus={event => event.currentTarget.select()} />}</div>;
}

