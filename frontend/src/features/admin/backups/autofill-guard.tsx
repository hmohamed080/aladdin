/**
 * A password manager treats the text field BEFORE a password as the login name and fills it. Here that
 * field was the typed confirmation phrase. This gives it a login field of its own; no action reads it.
 */
export function AutofillGuard() {
  return <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" readOnly className="sr-only" />;
}
