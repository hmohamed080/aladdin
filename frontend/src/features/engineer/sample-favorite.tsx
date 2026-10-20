"use client";
import { useState } from "react";
import { HeartIcon } from "@/components/ui/icons";
export function SampleFavorite({ label }: { label: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      className="engineer-photo-save"
      aria-label={label}
      aria-pressed={saved}
      onClick={() => setSaved(!saved)}
    >
      <HeartIcon size={19} />
      <span className="sr-only">{saved ? "✓" : ""}</span>
    </button>
  );
}
