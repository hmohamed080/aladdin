import { VerifyForm } from "@/features/auth/verify-form";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <VerifyForm next={sanitizeNext(next)} />;
}
