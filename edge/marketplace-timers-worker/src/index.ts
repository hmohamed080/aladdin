/**
 * Aladdin Marketplace timers Worker. NOT DEPLOYED: deploying it, binding its secrets and enabling it on any hosted environment need
 * the owner's approval (see README.md). It answers no HTTP request: it exists only for its cron trigger (every 5 minutes).
 */
import { type FetchLike, type TimersEnv, runTick } from "./runner.ts";

export { runTick } from "./runner.ts";

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: unknown, env: TimersEnv): Promise<void> {
    const summary = await runTick(env, fetch as unknown as FetchLike, (line) => console.log(line));
    // a failed tick is visible in Workers observability; the next tick is the retry (the database functions are idempotent)
    if (!summary.timers.ok) throw new Error("marketplace timers run failed");
  },
};
