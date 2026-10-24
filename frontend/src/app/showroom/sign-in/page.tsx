import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeNext } from "@/server/auth/next";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { ShowroomAuthShell } from "@/features/showroom-auth/shell";
import { ShowroomAuthForm } from "@/features/showroom-auth/form";
import { EntryAuthPanel } from "@/features/entry-auth/entry-auth-panel";
import { EntryEmailSignInForm } from "@/features/entry-auth/email-forms";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تسجيل الدخول — علاء الدين" };
export default async function ShowroomPage({ searchParams }: {
    searchParams: Promise<{
        next?: string;
        method?: string;
        error?: string;
    }>;
}) {
    const { data: { user } } = await (await getServerSupabase()).auth.getUser();
    if (user)
        redirect("/onboarding");
    const { next, method, error } = await searchParams;
    const safeNext = sanitizeNext(next);
    return <ShowroomAuthShell variant="signIn">
      <EntryAuthPanel kind="showroom" next={safeNext} providers={await oauthAvailability()} initialMethod={method === "email" ? "email" : "phone"} error={error} phone={<ShowroomAuthForm variant="signIn" next={safeNext}/>} email={<EntryEmailSignInForm kind="showroom" next={safeNext}/>}/>
    </ShowroomAuthShell>;
}
