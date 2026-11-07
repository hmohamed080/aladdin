/**
 * Pure normaliser/validator for the business social links captured during
 * Showroom onboarding (docs/frontend/showroom-social-links-onboarding.md).
 * Single source of the rules, shared by the screen, the server action and
 * the settings editor. No I/O.
 */

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "website",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialLinkReason =
  | "tooLong"
  | "invalid"
  | "unsafeScheme"
  | "wrongHost"
  | "badHost";

export type SocialLinkResult =
  | { ok: true; url: string | null }
  | { ok: false; reason: SocialLinkReason };

export type SocialLinks = Record<SocialPlatform, string | null>;

type RawLinks = Partial<Record<SocialPlatform, string | null | undefined>>;

const MAX_LENGTH = 300;

const SOCIAL_HOSTS: Record<Exclude<SocialPlatform, "website">, readonly string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

const HANDLE: Record<Exclude<SocialPlatform, "website">, RegExp> = {
  facebook: /^[A-Za-z0-9.]{5,50}$/,
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
};

const BANNED_SUFFIXES = [
  "localhost",
  ".local",
  ".internal",
  ".localhost",
  ".localdomain",
] as const;

const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f-\u009f]/;
const NON_ASCII = /[^\u0000-\u007f]/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,}$/;
const IPV4ISH = /^[0-9.]+$/;

const ALNUM = /[A-Za-z0-9]/;
const BAD_PERCENT = /%(?![0-9A-Fa-f]{2})/;

function isHandle(platform: Exclude<SocialPlatform, "website">, name: string) {
  return HANDLE[platform].test(name) && ALNUM.test(name);
}

function hasPunycodeLabel(host: string): boolean {
  return host.split(".").some((l) => l.startsWith("xn--"));
}

const fail = (reason: SocialLinkReason): SocialLinkResult => ({
  ok: false,
  reason,
});

function canonical(platform: SocialPlatform, name: string): string {
  if (platform === "tiktok") return `https://www.tiktok.com/@${name}`;
  if (platform === "instagram") return `https://www.instagram.com/${name}`;
  return `https://www.facebook.com/${name}`;
}

function finish(url: string): SocialLinkResult {
  return url.length > MAX_LENGTH ? fail("tooLong") : { ok: true, url };
}

function isBannedHost(host: string): boolean {
  return BANNED_SUFFIXES.some((s) =>
    s.startsWith(".") ? host.endsWith(s) : host === s,
  );
}

export function normalizeSocialLink(
  platform: SocialPlatform,
  raw: string | null | undefined,
): SocialLinkResult {
  const input = (raw ?? "").trim();
  if (input === "") return { ok: true, url: null };
  if (input.length > MAX_LENGTH) return fail("tooLong");
  if (CONTROL_OR_SPACE.test(input)) return fail("invalid");

  // new URL() treats "\\" as "/" for https, so raw-string and parser views
  // could diverge: refuse it outright.
  const backslash = input.indexOf("\\");
  if (backslash !== -1) {
    const firstSep = input.search(/[/?#]/);
    return fail(firstSep === -1 || backslash < firstSep ? "badHost" : "invalid");
  }

  // A bare token that fits the platform's handle pattern is a handle.
  if (platform !== "website" && !input.includes("/")) {
    const name = input.replace(/^@/, "");
    if (isHandle(platform, name)) return finish(canonical(platform, name));
    // Only host-looking leftovers (port, non-ASCII, escapes) get a host diagnosis.
    if (!/[:%]/.test(input) && !NON_ASCII.test(input)) return fail("invalid");
  }

  // Scheme: "x://" is explicit; "x:rest" is a scheme unless rest is a port.
  let rest = input;
  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(input);
  if (scheme) {
    const after = input.slice(scheme[0].length);
    const isPort = !scheme[2] && /^\d+([/?#]|$)/.test(after);
    if (!isPort) {
      const name = (scheme[1] ?? "").toLowerCase();
      if (name !== "http" && name !== "https") return fail("unsafeScheme");
      rest = after;
    }
  }

  const authority = rest.split(/[/?#]/, 1)[0] ?? "";
  if (authority === "") return fail("invalid");
  if (NON_ASCII.test(authority) || authority.includes("%")) {
    return fail("badHost");
  }
  const userinfo = authority.includes("@");
  const hostPart = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPart.startsWith("[") || hostPart.includes(":")) return fail("badHost");
  if (hasPunycodeLabel(hostPart.toLowerCase())) return fail("badHost");
  if (BAD_PERCENT.test(rest.slice(authority.length).split(/[?#]/, 1)[0] ?? "")) {
    return fail("invalid");
  }

  let url: URL;
  try {
    url = new URL(`https://${rest}`);
  } catch {
    return fail("invalid");
  }
  const host = url.hostname.toLowerCase();
  if (NON_ASCII.test(host) || hasPunycodeLabel(host)) return fail("badHost");
  if (IPV4ISH.test(host) || isBannedHost(host)) return fail("badHost");
  if (userinfo) return fail(platform === "website" ? "badHost" : "wrongHost");
  if (url.username || url.password || url.port) return fail("badHost");

  const path = url.pathname.replace(/\/+$/, "");

  if (platform === "website") {
    const labels = host.split(".");
    const tld = labels[labels.length - 1] ?? "";
    if (
      labels.length < 2 ||
      !labels.every((l) => LABEL.test(l)) ||
      !TLD.test(tld)
    ) {
      return fail("badHost");
    }
    return finish(`https://${host}${path}`);
  }

  const bare = host.replace(/^(www|m)\./, "");
  if (!SOCIAL_HOSTS[platform].includes(bare)) return fail("wrongHost");

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return fail("invalid");

  if (platform === "facebook") {
    if (!segments.every((s) => /^[A-Za-z0-9._%-]+$/.test(s))) {
      return fail("invalid");
    }
    if (segments.length === 1 && !isHandle("facebook", segments[0] ?? "")) {
      return fail("invalid");
    }
    return finish(`https://www.facebook.com/${segments.join("/")}`);
  }

  if (segments.length !== 1) return fail("invalid");
  const first = segments[0] ?? "";
  const name = first.replace(/^@/, "");
  if (platform === "tiktok" && !first.startsWith("@")) {
    return fail("invalid");
  }
  if (!isHandle(platform, name)) return fail("invalid");
  return finish(canonical(platform, name));
}

export function normalizeSocialLinks(
  raw: RawLinks,
):
  | { ok: true; links: SocialLinks }
  | { ok: false; platform: SocialPlatform; reason: SocialLinkReason } {
  const links: SocialLinks = {
    facebook: null,
    instagram: null,
    tiktok: null,
    website: null,
  };
  for (const platform of SOCIAL_PLATFORMS) {
    const result = normalizeSocialLink(platform, raw[platform]);
    if (!result.ok) return { ok: false, platform, reason: result.reason };
    links[platform] = result.url;
  }
  return { ok: true, links };
}

export function socialLinksError(
  raw: RawLinks,
): "onboarding.error.linksRequired" | "onboarding.error.linkInvalid" | null {
  const result = normalizeSocialLinks(raw);
  if (!result.ok) return "onboarding.error.linkInvalid";
  return SOCIAL_PLATFORMS.some((p) => result.links[p] !== null)
    ? null
    : "onboarding.error.linksRequired";
}
