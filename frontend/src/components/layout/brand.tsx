import { ApertureMark } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The Aladdin brand lockup — the Aperture mark + wordmark. Presentational; the
 * localized name is passed in so it works in both server and client trees. The
 * wordmark uses the Arabic display family (Reem Kufi) for the AR brand moment.
 */
export function Brand({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = size === "lg" ? 34 : size === "sm" ? 22 : 26;
  const text = size === "lg" ? "text-headline" : size === "sm" ? "text-body-lg" : "text-title";
  return (
    <span className={cn("inline-flex items-center gap-sm", className)}>
      <ApertureMark size={mark} />
      <span className={cn("font-display-ar leading-none text-fg", text)}>{name}</span>
    </span>
  );
}
