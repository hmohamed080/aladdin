import type { ReactNode } from "react";
import { Card } from "@/components/ui/primitives";
import { ApertureMark } from "@/components/ui/icons";

/**
 * The shared card shell for every account-access surface (Sign In, Sign Up,
 * Recovery, Verify). Keeps the Aperture mark + headline hierarchy identical across
 * routes so the flows read as one system; the caller supplies the body and an
 * optional footer (links row).
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <ApertureMark size={36} />
        <div className="flex flex-col gap-1">
          <h1 className="font-display-ar text-headline text-fg">{title}</h1>
          <p className="text-body-lg text-fg-secondary">{subtitle}</p>
        </div>
      </div>
      {children}
      {footer ? <div className="border-t pt-md text-center text-body text-fg-secondary">{footer}</div> : null}
    </Card>
  );
}
