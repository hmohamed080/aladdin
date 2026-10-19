// The small subset of the Workers runtime this Worker uses. Declared here instead
// of depending on @cloudflare/workers-types so the package stays dependency-light;
// the shapes match https://developers.cloudflare.com/r2/api/workers/workers-api-reference/.
export type R2Range = { offset: number; length: number };

export interface R2ObjectBody {
  readonly size: number;
  readonly body: ReadableStream<Uint8Array>;
}
export interface R2ObjectHead { readonly size: number }

export interface R2BucketLike {
  get(key: string, options?: { range?: R2Range }): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2ObjectHead | null>;
}

export interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void }

export interface Env {
  /** Private R2 bucket binding. The bucket must never have public access or r2.dev enabled. */
  MEDIA_BUCKET: R2BucketLike;
  /** Hyperdrive binding to Postgres with query caching DISABLED. */
  HYPERDRIVE: { connectionString: string };
  /** Secret: JSON object `{"<kid>":"<base64url secret>"}`; two entries during rotation. */
  TICKET_KEYS: string;
  /** "on" enables /m (private). Anything else disables it. */
  PRIVATE_ROUTES?: string;
  /** "on" enables /c (conditional public). Anything else disables it. */
  PUBLIC_ROUTES?: string;
}

/** What the database authorizes for exactly one request. */
export type MediaGrant = { object: string; contentType: string; size: number | null; sha256: string };

export interface MediaAuthority {
  authorizePrivate(request: {
    namespace: string; key: string; variant: string;
    viewer: string; session: string; workspace: string | null; expiresAt: number;
  }): Promise<unknown>;
  authorizePublic(request: { namespace: string; id: string; variant: string }): Promise<unknown>;
  close(): Promise<void>;
}
