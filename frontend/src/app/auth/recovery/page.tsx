import { RecoveryForm } from "@/features/auth/recovery-form";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <RecoveryForm next={sanitizeNext(next)} />;
}
