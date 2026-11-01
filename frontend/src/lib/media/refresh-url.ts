/** Edge URLs look like `<origin>/m/<namespace>/<variant>?t=<ticket>`; app-proxy URLs never expire. */
const EDGE_URL = /\/m\/[a-z]+\/(original|thumb|card|full)\?t=/;

export function isRefreshableMediaUrl(url: string): boolean {
  return EDGE_URL.test(url);
}

/** Asks the server for a fresh URL once an edge ticket has expired. Null: really unavailable. */
export async function refreshMediaUrl(url: string): Promise<string | null> {
  if (!isRefreshableMediaUrl(url)) return null;
  try {
    const { refreshMediaUrlAction } = await import("@/server/actions/media-url-refresh");
    return await refreshMediaUrlAction(url);
  } catch {
    return null;
  }
}
