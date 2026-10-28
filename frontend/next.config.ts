import path from "node:path";
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security/response-headers";

// Set by open-next.config.ts `buildCommand` for the Cloudflare Workers build only.
// That build swaps the image engine (sharp cannot load in workerd) so the Worker
// bundle never contains sharp; the plain `next build` keeps the Node module.
const WORKERS_BUILD = process.env.ALADDIN_BUILD_TARGET === "workers";
const IMAGE_RUNTIME = /[\\/]server[\\/]storage[\\/]image-processing[\\/]runtime\.ts$/;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Revocable media must never enter the optimizer cache, even through a crafted URL.
  images: { localPatterns: ["assets", "brand", "demo", "images", "installer-auth", "landing-v2", "preview", "_next/static/media"]
    .map((directory) => ({ pathname: `/${directory}/**`, search: "" })) },
  // App Router is the default in Next 15. No Vite, no custom SPA routing.
  webpack(config, { webpack, isServer }) {
    if (WORKERS_BUILD && config.cache && typeof config.cache === "object") {
      // A separate persistent cache: otherwise a later Node build on the same
      // machine reuses the swapped module graph (and would ship without sharp).
      config.cache.name = `${config.cache.name ?? `${config.name}-${config.mode}`}-workers`;
    }
    if (WORKERS_BUILD && isServer) {
      const workersRuntime = path.join(__dirname, "src/server/storage/image-processing/runtime.workers.ts");
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(IMAGE_RUNTIME, (resource: { createData?: { resource?: string } }) => {
        if (resource.createData?.resource) resource.createData.resource = workersRuntime;
      }));
    }
    return config;
  },

  // Baseline security headers on every response (security audit 2026-10-22).
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },

  // Compatibility for links shared while the installer phone + password pages
  // were a temporary preview: permanent (308) redirects to the promoted routes.
  // The query string is carried over by Next.js as-is; the destination pages
  // validate anything they read from it (e.g. `next` via sanitizeNext).
  async redirects() {
    return [
      // The separate craftsman and showroom phone pages were retired (2026-10-28): one sign-in
      // takes a mobile number, username or email, and one sign-up takes a mobile number or email.
      { source: "/temporary/craftsman/sign-up", destination: "/auth/sign-up?type=installer_technician", permanent: true },
      { source: "/temporary/craftsman/sign-in", destination: "/auth/sign-in", permanent: true },
      { source: "/installer/sign-up", destination: "/auth/sign-up?type=installer_technician", permanent: true },
      { source: "/installer/sign-in", destination: "/auth/sign-in", permanent: true },
      { source: "/showroom/sign-up", destination: "/auth/sign-up?type=showroom_dealer", permanent: true },
      { source: "/showroom/sign-in", destination: "/auth/sign-in", permanent: true },
      // Showroom V2 was reviewed under /preview/showroom-suite-v2; it now lives at /showroom (links stay valid).
      { source: "/preview/showroom-suite-v2", destination: "/showroom", permanent: true },
      { source: "/preview/showroom-suite-v2/:path*", destination: "/showroom/:path*", permanent: true },
      // The Admin dashboard was reviewed under /admin/preview; it now owns the Admin routes.
      { source: "/admin/preview", destination: "/admin", permanent: true },
      { source: "/admin/preview/:path*", destination: "/admin/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
