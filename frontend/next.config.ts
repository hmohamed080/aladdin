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
};

export default nextConfig;
