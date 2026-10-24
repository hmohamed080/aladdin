import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Revocable media must never enter the optimizer cache, even through a crafted URL.
  images: { localPatterns: ["assets", "brand", "demo", "images", "installer-auth", "landing-v2", "preview", "_next/static/media"]
    .map((directory) => ({ pathname: `/${directory}/**`, search: "" })) },
  // App Router is the default in Next 15. No Vite, no custom SPA routing.

  // Compatibility for links shared while the installer phone + password pages
  // were a temporary preview: permanent (308) redirects to the promoted routes.
  // The query string is carried over by Next.js as-is; the destination pages
  // validate anything they read from it (e.g. `next` via sanitizeNext).
  async redirects() {
    return [
      // The Showroom sign-in is THE sign-in page and lives at the short URL /sign-in (see rewrites below);
      // the old path keeps working. Temporary (307), not 308, so browsers do not cache it forever.
      { source: "/showroom/sign-in", destination: "/sign-in", permanent: false },
      { source: "/temporary/craftsman/sign-up", destination: "/installer/sign-up", permanent: true },
      { source: "/temporary/craftsman/sign-in", destination: "/installer/sign-in", permanent: true },
      // Showroom V2 was reviewed under /preview/showroom-suite-v2; it now lives at /showroom (links stay valid).
      { source: "/preview/showroom-suite-v2", destination: "/showroom", permanent: true },
      { source: "/preview/showroom-suite-v2/:path*", destination: "/showroom/:path*", permanent: true },
      // The Admin dashboard was reviewed under /admin/preview; it now owns the Admin routes.
      { source: "/admin/preview", destination: "/admin", permanent: true },
      { source: "/admin/preview/:path*", destination: "/admin/:path*", permanent: true },
    ];
  },

  // /sign-in is served by the Showroom sign-in page without changing the address bar.
  // Middleware and Server Actions see the public path /sign-in.
  async rewrites() {
    return [{ source: "/sign-in", destination: "/showroom/sign-in" }];
  },
};

export default nextConfig;
