export const ACCEPTANCE_PREVIEW_ORIGIN: string;
export const ID_ENV: string;
export const SECRET_ENV: string;
export interface AccessCredentials { id: string; secret: string }
export function readAccessCredentials(env: Record<string, string | undefined>): AccessCredentials;
export function scrubError(error: unknown, creds: AccessCredentials): string;
export function isPreviewOrigin(url: string, origin?: string): boolean;
export function accessHeadersFor(url: string, creds: AccessCredentials, origin?: string): Record<string, string>;
export function installAccessRouting(
  context: import("@playwright/test").BrowserContext,
  creds: AccessCredentials,
  options?: { origin?: string; onViolation?: (message: string) => void },
): Promise<void>;
export function isAccessLogin(url: string): boolean;
export function judgePreflight(r: { status: number; location?: string | null; contentType?: string | null; body: string }): string[];
export function preflight(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<string[]>;
