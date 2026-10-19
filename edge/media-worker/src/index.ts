import { postgresAuthority } from "./authority";
import { createHandler } from "./handler";
import type { Env, ExecutionContextLike } from "./types";

const handle = createHandler({ authority: (env) => postgresAuthority(env.HYPERDRIVE.connectionString), now: () => Date.now() });

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return handle(request, env, ctx);
  },
};
