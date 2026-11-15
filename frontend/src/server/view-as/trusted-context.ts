import { VIEW_AS_CONTEXT_HEADER, viewAsContextFor, type ViewAsContext, type ViewAsGateInput } from "./read-only-gate";

/**
 * Edge only (middleware): strip any client-supplied context header, then set the trusted one from the real path / Referer.
 * Mutates `headers` (the request headers the middleware forwards). Kept apart from the gate so the server-side closure
 * (which only READS the header) never carries a header-mutating call.
 */
export function applyViewAsContext(headers: Headers, input: ViewAsGateInput): ViewAsContext | null {
  headers.delete(VIEW_AS_CONTEXT_HEADER);
  const ctx = viewAsContextFor(input);
  if (ctx) headers.set(VIEW_AS_CONTEXT_HEADER, ctx);
  return ctx;
}
