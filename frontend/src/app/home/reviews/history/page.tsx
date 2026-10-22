import { redirect } from "next/navigation";

/**
 * `/home/reviews/history` - the full review history IS the Reviews workspace (keyset-paged, every order, search and
 * date range, CSV export), so this address opens it rather than drawing a second copy of the same list.
 */
export default function ReviewsHistoryRoute(): never {
  redirect("/home/reviews");
}
