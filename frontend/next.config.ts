import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // App Router is the default in Next 15. No Vite, no custom SPA routing.

  // Compatibility for links shared while the installer phone + password pages
  // were a temporary preview: permanent (308) redirects to the promoted routes.
  // The query string is carried over by Next.js as-is; the destination pages
  // validate anything they read from it (e.g. `next` via sanitizeNext).
  async redirects() {
    return [
      { source: "/temporary/craftsman/sign-up", destination: "/installer/sign-up", permanent: true },
      { source: "/temporary/craftsman/sign-in", destination: "/installer/sign-in", permanent: true },
    ];
  },
};

export default nextConfig;
