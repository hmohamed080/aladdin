// Starts the video transcode container (NOT deployed; see
// docs/architecture/video-transcode-cloudflare-containers.md).
//
// The Durable Object only keeps a container running; it holds no job state.
// Postgres decides which video runs (video_job_claim: leased, SKIP LOCKED,
// three attempts), so a duplicate start or a lost container costs a few
// seconds, never a duplicate or lost job. Each slot is one Durable Object with
// at most one container, which drains every claimable video and exits.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

interface Env {
  TRANSCODE: DurableObjectNamespace<TranscodeSlot>;
  TRANSCODE_SLOTS: string;
  APP_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_PRIVATE_BUCKET: string;
}

// Exactly what app.config reads for the worker; nothing else enters the container.
const CONTAINER_ENV = [
  "APP_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PRIVATE_BUCKET",
] as const;

// Without activity the platform stops the container after the inactivity
// timeout (at most 6 h). A transcode can run longer, so an alarm wakes the
// object while the container runs and extends it.
const INACTIVITY_MS = 30 * 60_000;
const HEARTBEAT_MS = 5 * 60_000;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export class TranscodeSlot extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A restarted object (deploy, eviction) loses its timeout and its monitor.
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(async () => {
        await ctx.container!.setInactivityTimeout(INACTIVITY_MS);
        this.watch();
      });
    }
  }

  async kick(): Promise<"started" | "running"> {
    const container = this.ctx.container;
    if (!container) throw new Error("no container is configured for TranscodeSlot");
    if (container.running) return "running";
    const env: Record<string, string> = {};
    for (const name of CONTAINER_ENV) {
      const value = this.env[name];
      if (!value) throw new Error(`missing ${name}`); // fail closed, never start half-configured
      env[name] = value;
    }
    // Default scheduling policy: image and size come from wrangler.jsonc. The
    // container needs the Internet for Supabase and the R2 S3 endpoint.
    container.start({ env, enableInternet: true });
    await container.setInactivityTimeout(INACTIVITY_MS);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    this.watch();
    log("transcode.started");
    return "started";
  }

  async alarm(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    await container.setInactivityTimeout(INACTIVITY_MS);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  private watch(): void {
    // Exit 0: drained. Non-zero: a job was released for a retry (see the
    // worker's own logs). Either way the database already knows.
    this.ctx.container?.monitor().then(
      () => log("transcode.exited", { exitCode: 0 }),
      (error: unknown) =>
        log("transcode.failed", {
          exitCode: (error as { exitCode?: number }).exitCode ?? null,
          error: String(error).slice(0, 200),
        }),
    );
  }
}

// Starts at most one new container per call: the first idle slot. Busy slots
// are skipped, so a backlog gets more parallelism on the next call.
async function kickOne(env: Env): Promise<string> {
  const slots = Math.max(1, Number.parseInt(env.TRANSCODE_SLOTS, 10) || 1);
  for (let i = 0; i < slots; i++) {
    const result = await env.TRANSCODE.getByName(`slot-${i}`).kick();
    if (result === "started") return `slot-${i}`;
  }
  return "all-busy";
}

export default class TranscodeWorker extends WorkerEntrypoint<Env> {
  // No public surface: nothing to call over HTTP.
  override async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  }

  override async scheduled(): Promise<void> {
    log("transcode.cron", { slot: await kickOne(this.env) });
  }

  // For a service binding from the app after an upload completes. Carries no
  // data: the worker reads the queue from the database.
  async wake(): Promise<string> {
    return kickOne(this.env);
  }
}
