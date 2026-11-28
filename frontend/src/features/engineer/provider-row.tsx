"use client";

import { useActionState, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { InlineError } from "@/components/ui/primitives";
import { unlinkProviderAction, type UnlinkState } from "@/server/actions/sign-in-methods";

type Provider = "google" | "facebook";

const INITIAL: UnlinkState = { ok: false };

/** One social sign-in method: Connect (browser round trip to the provider) or Disconnect. */
export function ProviderRow({
  provider,
  name,
  connected,
  detail,
  available,
  ar,
}: {
  provider: Provider;
  name: string;
  connected: boolean;
  /** The linked provider account (masked email or name), shown next to "Connected". */
  detail?: string;
  available: boolean;
  ar: boolean;
}) {
  const [state, unlink] = useActionState(unlinkProviderAction, INITIAL);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("link", "1");
    callback.searchParams.set("provider", provider);
    const { error: linkError } = await createBrowserSupabaseClient().auth.linkIdentity({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (linkError) setError(ar ? "تعذر بدء الربط. حاول مرة أخرى لاحقًا." : "Couldn't start connecting. Try again later.");
  };

  const status = !available
    ? ar ? "غير متاح حاليًا" : "Not available yet"
    : connected
      ? ar ? "متصل" : "Connected"
      : ar ? "غير متصل" : "Not connected";

  return (
    <div className="engineer-method-row engineer-provider-row">
      <span><strong>{name}</strong><small>{status}{connected && available && detail ? <> · <bdi dir="ltr">{detail}</bdi></> : null}</small></span>
      {available ? (
        connected ? (
          <form action={unlink}>
            <input type="hidden" name="provider" value={provider} />
            <button type="submit">{ar ? "فصل" : "Disconnect"}</button>
          </form>
        ) : (
          <button type="button" onClick={connect}>{ar ? "ربط" : "Connect"}</button>
        )
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {!state.ok && state.code === "last" ? <InlineError>{ar ? "هذه آخر وسيلة لتسجيل الدخول، ولا يمكن فصلها." : "This is your only way to sign in, so it can't be disconnected."}</InlineError> : null}
      {!state.ok && state.code === "error" ? <InlineError>{ar ? "تعذر الفصل. حاول مرة أخرى." : "Couldn't disconnect. Try again."}</InlineError> : null}
    </div>
  );
}
