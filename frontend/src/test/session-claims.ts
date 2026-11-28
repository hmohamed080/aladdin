/**
 * Test shim: a `getClaims()` that answers from an existing `getUser()` mock, so a
 * test written against "the session's user" keeps one source of truth while the
 * code under test reads the locally verified claims (server/auth/session.ts).
 */
type UserResult = { data: { user: { id: string; email?: string | null; phone?: string | null } | null } };

export function claimsFrom(getUser: () => Promise<UserResult> | UserResult) {
  return async () => {
    const user = (await getUser())?.data?.user ?? null;
    if (!user) return { data: null, error: null };
    return {
      data: {
        claims: {
          sub: user.id,
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
          email: user.email ?? undefined,
          phone: user.phone ?? undefined,
          session_id: "s-test",
        },
      },
      error: null,
    };
  };
}
