/**
 * The geometry and states every text-entry-shaped control shares (Input, Textarea, Select). One string, so a field,
 * a textarea and a select line up exactly and a focus ring or an invalid border is changed in ONE place.
 */
export const fieldBase =
  "w-full rounded-md border border-strong bg-canvas px-3.5 py-2.5 text-body-lg text-fg placeholder:text-fg-muted " +
  "transition-[border-color,box-shadow] duration-fast " +
  "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-0 " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/30";
