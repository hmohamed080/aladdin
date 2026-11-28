/**
 * `aladdin-backend` Worker (ADR-0022): the FastAPI service (backend/Dockerfile)
 * running in a Cloudflare Container.
 *
 * The frontend Worker reaches it through the `BACKEND` service binding, so it
 * has no public hostname: `workers_dev` is off and there are no routes. It
 * serves only `/api/backend/*`, the same paths FastAPI declares, and forwards
 * them unchanged (the frontend proxy has already set the forwarding headers).
 */
import { Container } from "@cloudflare/containers";
import { ConfigurationError, containerEnv, instanceCount, instanceName, isBackendPath, serviceError } from "./policy";

export interface Env {
  BACKEND_CONTAINER: DurableObjectNamespace<BackendContainer>;
  /** Size of the instance pool, "1".."8" (policy.instanceCount). */
  BACKEND_INSTANCES?: string;
  [name: string]: unknown;
}

/** uvicorn's port in backend/Dockerfile. */
const PORT = 8000;

export class BackendContainer extends Container<Env> {
  defaultPort = PORT;
  // Scale to zero: an idle instance stops after 10 minutes and costs nothing
  // until the next request, which waits for a cold start (about 2 s measured).
  sleepAfter = "10m";
  // Outbound HTTPS to Supabase (JWKS, RPC), Upstash Redis and OpenAI.
  enableInternet = true;
  // Readiness probe: any HTTP answer from FastAPI means uvicorn is serving.
  pingEndpoint = "localhost/api/backend/health";

  override async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container?.running) {
      try {
        await this.startAndWaitForPorts({
          ports: PORT,
          startOptions: { envVars: containerEnv(this.env) },
          cancellationOptions: { portReadyTimeoutMS: 30_000 },
        });
      } catch (error) {
        // Details go to Workers Logs only, never to the caller.
        const detail = error instanceof ConfigurationError ? error.message : String(error);
        console.error(JSON.stringify({ event: "backend.container_unavailable", detail }));
        return serviceError(503, "unavailable");
      }
    }
    try {
      return await this.containerFetch(request, PORT);
    } catch (error) {
      console.error(JSON.stringify({ event: "backend.container_fetch_failed", detail: String(error) }));
      return serviceError(503, "unavailable");
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isBackendPath(new URL(request.url).pathname)) return serviceError(404, "not_found");
    const name = instanceName(instanceCount(env.BACKEND_INSTANCES));
    // Supabase runs in eu-west-3 (Paris): keep the Durable Object in Western Europe too.
    const stub = env.BACKEND_CONTAINER.get(env.BACKEND_CONTAINER.idFromName(name), { locationHint: "weur" });
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
