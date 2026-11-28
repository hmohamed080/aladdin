import { readPublicEnv } from "@/lib/env";

/** The approved support contact as a link (`mailto:` for an address, the URL otherwise), or null when none is configured. */
export function readEnvSupportContact(): string | null {
  const contact = readPublicEnv().NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
  if (!contact) return null;
  if (/^https?:\/\//i.test(contact)) return contact;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) return `mailto:${contact}`;
  return null;
}
