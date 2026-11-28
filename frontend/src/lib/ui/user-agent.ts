export type DeviceDescription = { browser: string | null; os: string | null; mobile: boolean };

/**
 * A short, human description of a `User-Agent` string for the sessions and
 * devices lists: `Chrome` + `Windows`. Order matters (Edge and Opera also say
 * "Chrome", Chrome also says "Safari"). Anything unrecognized (a script, an
 * empty value) comes back with nulls so the caller can show a neutral label.
 */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const ua = userAgent ?? "";
  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  const os =
    /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux|X11/.test(ua) ? "Linux"
    : null;
  return { browser, os, mobile: /iPhone|iPod|Android.*Mobile|Mobile Safari/.test(ua) };
}

/** `Chrome on Windows`, or the fallback when nothing is recognized. */
export function deviceLabel(userAgent: string | null | undefined, on: string, fallback: string): string {
  const { browser, os } = describeUserAgent(userAgent);
  if (browser && os) return `${browser} ${on} ${os}`;
  return browser ?? os ?? fallback;
}

/** `203.0.113.45` → `203.0.113.•`; IPv6 keeps its first two groups. Enough to recognize, not to locate. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip || ip === "::1" || ip.startsWith("127.")) return null;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:•`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.•` : null;
}
