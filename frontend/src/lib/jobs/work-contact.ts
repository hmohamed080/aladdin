import { isE164 } from "@/lib/contact/phone";

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The optional WORK CONTACT section. Provided deliberately for this job — never
 * taken from anyone's profile. The phone arrives already canonical (E.164) from the
 * form's phone picker; a number typed but not valid is flagged by the form
 * (`contactPhoneInvalid`) so it is refused here instead of being silently dropped.
 * `present` is false when the form sent no contact fields at all (nothing to save).
 */
export function readWorkContact(fd: FormData) {
  const present = ["contactName", "contactPhone", "contactPhoneInvalid", "contactEmail"].some((k) => fd.has(k));
  const name = str(fd, "contactName");
  const phone = str(fd, "contactPhone");
  const email = str(fd, "contactEmail");
  const fieldErrors: Record<string, string> = {};
  if (str(fd, "contactPhoneInvalid") === "1" || (phone && !isE164(phone))) fieldErrors.contactPhone = "jobs.validation.contactPhoneInvalid";
  if (email && (!EMAIL.test(email) || email.length > 254)) fieldErrors.contactEmail = "jobs.validation.contactEmailInvalid";
  if (name && !phone && !email && !fieldErrors.contactPhone && !fieldErrors.contactEmail) fieldErrors.contactPhone = "jobs.validation.contactReach";
  return { present, fieldErrors, values: { name, phoneE164: phone, email } };
}
