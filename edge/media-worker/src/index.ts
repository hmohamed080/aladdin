import { postgresAuthority } from "./authority";
import { createHandler } from "./handler";
import type { ByteCacheLike, Env, ExecutionContextLike } from "./types";

const handle = createHandler({
  authority: (env) => postgresAuthority(env.HYPERDRIVE.connectionString),
  now: () => Date.now(),
  // `caches.default` exists on Workers custom domains and on Pages; elsewhere the
  // Worker simply reads R2 every time.
  cache: () => (globalThis as { caches?: { default?: ByteCacheLike } }).caches?.default ?? null,
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return handle(request, env, ctx);
  },
};
