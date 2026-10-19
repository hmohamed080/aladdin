import type { MediaNamespace } from "./provider-types";

/** An identifier, never a bearer credential; each GET rechecks current authority. */
export function applicationMediaUrl(namespace: MediaNamespace, key: string, workspace?: string | null) {
  return `/api/media/${namespace}?key=${encodeURIComponent(key)}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}`;
}
