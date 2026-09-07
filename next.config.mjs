const isProd = process.env.NODE_ENV === "production";

// Turbopack/webpack dev mode needs 'unsafe-eval' for HMR; production
// doesn't. 'unsafe-inline' is needed in both for Next.js's own hydration
// bootstrap scripts and this app's inline theme <style> tag
// (src/app/layout.tsx) — neither uses a nonce-based CSP, which would be a
// bigger lift than this hardening pass calls for.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // Costume photos are served from Google Drive — keep in sync with the
  // remotePatterns below if that ever changes.
  "img-src 'self' data: https://drive.google.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to browser features this app never uses.
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
];

if (isProd) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.1.142"],
  images: {
    // Costume photos are served from Google Drive (or another photo-storage
    // implementation) and referenced by URL rather than bundled locally.
    remotePatterns: [
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Belt-and-suspenders alongside the auth gate and robots.txt — an
        // X-Robots-Tag header keeps admin pages out of search indexes even
        // if a crawler ignores robots.txt.
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
