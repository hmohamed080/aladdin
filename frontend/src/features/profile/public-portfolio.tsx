import { Card } from "@/components/ui/primitives";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { PublicPortfolioItem } from "@/server/queries/portfolio";
import { MediaFrame, MediaImage } from "@/features/portfolio/media-frame";
import type { MediaSource } from "@/lib/media/image-variants";
import { mergeMedia } from "@/lib/media/media-order";
import type { VideoPlayback } from "@/server/video/playback";
import { VideoPlayer } from "@/features/video/video-player";
import type { PublicPortfolioProject } from "@/server/queries/portfolio-projects";

/**
 * A professional's published work, on their public profile.
 *
 * IT RENDERS NOTHING WHEN THERE IS NOTHING (§12). No empty section, no "no work
 * yet" panel, no count of what is being withheld — a visitor must not be able to
 * tell a professional with no portfolio from one who keeps theirs private, and an
 * empty designed section announces the difference as loudly as a number would.
 * The caller checks `items.length` and simply does not render this.
 *
 * WHAT IT KNOWS is only what the projection carries: an id, a title, an optional
 * description, in the owner's order. There is no visibility flag here to get
 * wrong, no state, no storage key and no owner id — the view does not expose them,
 * so this component could not leak one if it tried.
 *
 * THE IMAGE comes from `/p/media/<id>`, which re-proves publication for that exact
 * object before it serves a byte. So the two halves agree by construction: an item
 * that reaches this list is one the media route will serve, and an item the route
 * refuses is one the list never had.
 *
 * `media` is OPTIONAL and comes from the URL issuer: the same opaque item
 * identity, plus thumb/card variant URLs once they exist. Without it the card
 * uses `/p/media/<id>` exactly as before.
 */
export function PublicPortfolio({
  items,
  videos = [],
  t,
}: {
  items: Array<PublicPortfolioItem & { media?: MediaSource | null }>;
  /** Published videos, placed among the photos in the owner's order. */
  videos?: VideoPlayback[];
  t: TranslateFn;
}) {
  if (items.length === 0 && videos.length === 0) return null;
  const entries = mergeMedia(items.map((item) => ({ ...item, position: item.sortOrder ?? null })), videos);

  return (
    <section className="flex flex-col gap-md" aria-labelledby="public-portfolio">
      <h2 id="public-portfolio" className="text-title text-fg">
        {t("profile.publicPage.portfolio")}
      </h2>

      <ul className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {entries.map((entry) => {
          if (entry.kind === "video") {
            const video = entry.item;
            return (
              <li key={`video-${video.id}`} data-testid="public-portfolio-video">
                <Card pad="sm" className="flex h-full flex-col gap-3">
                  <MediaFrame>
                    <VideoPlayer fill source={video} title={video.title} width={video.width} height={video.height}
                      labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
                  </MediaFrame>
                  <h3 className="text-label font-medium text-fg">
                    <bdi dir="auto">{video.title}</bdi>
                  </h3>
                </Card>
              </li>
            );
          }
          const item = entry.item;
          return (
          <li key={item.id}>
            <Card pad="sm" className="flex h-full flex-col gap-3">
              <MediaFrame>
                {/* The media route re-proves publication per request, so
                    next/image must never cache it past the moment it stops
                    being published; MediaImage stays a plain <img>. */}
                <MediaImage source={item.media ?? { src: `/p/media/${item.id}` }} alt={item.title} />
              </MediaFrame>
              <div className="flex min-w-0 flex-col gap-1">
                {/* `<bdi>`, not `dir="auto"` on the block. Both lines are
                    user-entered, so both must resolve their own direction — but
                    setting it on the paragraph flips the paragraph, and an
                    English title then aligns left on an Arabic profile while
                    everything around it aligns right. `<bdi>` isolates the text
                    run and leaves the block alone. */}
                <h3 className="text-label font-medium text-fg">
                  <bdi dir="auto">{item.title}</bdi>
                </h3>
                {item.description ? (
                  <p className="line-clamp-3 text-label text-fg-secondary">
                    <bdi dir="auto">{item.description}</bdi>
                  </p>
                ) : null}
              </div>
            </Card>
          </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Published portfolio PROJECTS (20261024090010): each one titled, with its
 * optional location and description, its cover first and then its other photos
 * and videos in the owner's order. Like the flat list it renders nothing when
 * there is nothing, and every photo still comes through the publication-checking
 * media route.
 */
export function PublicPortfolioProjects({ projects, t }: { projects: PublicPortfolioProject[]; t: TranslateFn }) {
  if (projects.length === 0) return null;
  return (
    <section className="flex flex-col gap-md" aria-labelledby="public-portfolio-projects" data-testid="public-portfolio-projects">
      <h2 id="public-portfolio-projects" className="text-title text-fg">{t("profile.publicPage.portfolio")}</h2>
      {projects.map((project) => {
        const order = project.cover
          ? [project.cover, ...project.order.filter((m) => !(m.kind === project.cover!.kind && m.id === project.cover!.id))]
          : project.order;
        return (
          <article key={project.id} className="flex flex-col gap-sm" data-testid="public-portfolio-project">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-body-lg font-semibold text-fg"><bdi dir="auto">{project.title}</bdi></h3>
              {project.location ? <p className="text-label text-fg-secondary"><bdi dir="auto">{project.location}</bdi></p> : null}
              {project.description ? <p className="max-w-prose text-label text-fg-secondary"><bdi dir="auto">{project.description}</bdi></p> : null}
            </div>
            <ul className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-3">
              {order.map((entry) => {
                if (entry.kind === "video") {
                  const video = project.videos.find((v) => v.id === entry.id);
                  return video ? (
                    <li key={`video-${video.id}`}>
                      <MediaFrame>
                        <VideoPlayer fill source={video} title={video.title} width={video.width} height={video.height}
                          labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
                      </MediaFrame>
                    </li>
                  ) : null;
                }
                const photo = project.photos.find((p) => p.id === entry.id);
                return photo ? (
                  <li key={photo.id}>
                    <MediaFrame>
                      <MediaImage source={photo.media ?? { src: `/p/media/${photo.id}` }} alt={photo.title} />
                    </MediaFrame>
                  </li>
                ) : null;
              })}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
