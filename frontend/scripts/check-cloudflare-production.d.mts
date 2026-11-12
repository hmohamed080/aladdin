// Types for check-cloudflare-production.mjs (imported by its tests).
export type WranglerEnv = {
  [key: string]: unknown;
  name?: string;
  workers_dev?: boolean;
  services: { binding: string; service: string }[];
  vars: Record<string, string>;
};
export type WranglerConfig = { [key: string]: unknown; env: Record<string, WranglerEnv> & { production: WranglerEnv } };

export const LIVE_SUPABASE_URL: string;
export const LIVE_HOSTNAMES: string[];
export function parseJsonc(text: string): WranglerConfig;
export function checkFrontend(config: WranglerConfig): string[];
export function checkBackend(config: WranglerConfig): string[];
export function jwtProjectRef(key: string): string | null;
export function checkLiveValues(values: Record<string, string | undefined>): string[];
export const R2_ONLY_FLAGS: Record<string, string>;
export function checkCutoverStage(stage: string | undefined, approved: string | undefined): string[];
export const MEDIA_MODES: string[];
export const LEGACY_HOLD_FLAGS: Record<string, string>;
export function mediaModeArgs(mode: string): string[];
export function effectiveMediaFlags(config: WranglerConfig, mode: string): Record<string, string | undefined>;
export function checkMediaMode(config: WranglerConfig, mode: string): string[];
