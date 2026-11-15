/**
 * Admin View-As: the seam that maps an owner's media reference to the view door URL.
 *
 * Real (exact-parity) components ask the shared media URL builder for a file; inside a view that builder resolves through
 * here, so avatars, portfolio images, certificates and videos load from the view's own same-origin door and never from
 * `/api/media` (which refuses an admin) or a storage/signed URL. The browser only ever holds the opaque media id.
 *
 * Two URL trees share ONE server implementation (`server/view-as/media-delivery.ts`):
 *   "exact"  -> /view-as/<id>/media/...            (the exact-parity shell)
 *   "legacy" -> /admin/users/<id>/view/media/...   (the current read-only view; keeps working)
 *
 * Pure and client-safe: no server imports.
 */
export type ViewMediaTree = "exact" | "legacy";
export type ViewImageNamespace = "avatar" | "portfolio" | "certificate";
export type ViewMediaRef =
  | { namespace: ViewImageNamespace; id: string }
  | { namespace: "video"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base(tree: ViewMediaTree, userId: string): string {
  if (!UUID.test(userId)) throw new Error("view-as media: invalid user id");
  return tree === "exact" ? `/view-as/${userId}/media` : `/admin/users/${userId}/view/media`;
}
function checked(id: string): string {
  if (!UUID.test(id)) throw new Error("view-as media: invalid media id");
  return id;
}

/** URL of a viewed account's private image or certificate (opaque id only). */
export function viewMediaUrl(tree: ViewMediaTree, userId: string, namespace: ViewImageNamespace, mediaId: string): string {
  return `${base(tree, userId)}/${namespace}/${checked(mediaId)}`;
}

/** HLS master playlist of a viewed portfolio video; relative playlist URIs resolve under the same door. */
export function viewVideoSrc(tree: ViewMediaTree, userId: string, videoId: string): string {
  return `${base(tree, userId)}/video/${checked(videoId)}/master.m3u8`;
}

/** Poster frame of a viewed video (only valid when the video has a poster). */
export function viewVideoPoster(tree: ViewMediaTree, userId: string, videoId: string): string {
  return `${base(tree, userId)}/video/${checked(videoId)}/poster.jpg`;
}

/** Owner media reference -> view door URL (images and certificates directly; a video resolves to its master playlist). */
export function viewMediaUrlFor(tree: ViewMediaTree, userId: string, ref: ViewMediaRef): string {
  return ref.namespace === "video" ? viewVideoSrc(tree, userId, ref.id) : viewMediaUrl(tree, userId, ref.namespace, ref.id);
}
