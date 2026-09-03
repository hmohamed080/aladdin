import { Card } from "@/components/ui/primitives";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { PublicPortfolioItem } from "@/server/queries/portfolio";
import { MediaFrame } from "@/features/portfolio/media-frame";

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
 */
export function PublicPortfolio({
  items,
  t,
}: {
  items: PublicPortfolioItem[];
  t: TranslateFn;
}) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-md" aria-labelledby="public-portfolio">
      <h2 id="public-portfolio" className="text-title text-fg">
        {t("profile.publicPage.portfolio")}
      </h2>

      <ul className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card pad="sm" className="flex h-full flex-col gap-3">
              <MediaFrame>
                {/* The media route streams bytes behind a short-lived signed
                    URL, which next/image cannot optimise without a loader that
                    would cache it past the moment it stops being published. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/p/media/${item.id}`}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </MediaFrame>
              <div className="flex min-w-0 flex-col gap-1">
                {/* Both lines are user-entered, so both resolve their own
                    direction. An English title on an Arabic profile would
                    otherwise be clipped from its front. */}
                <h3 dir="auto" className="text-label font-medium text-fg">
                  {item.title}
                </h3>
                {item.description ? (
                  <p dir="auto" className="line-clamp-3 text-label text-fg-secondary">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
