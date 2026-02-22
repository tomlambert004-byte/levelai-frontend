import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";
const PROD_ORIGIN = "https://lvlai.app";

const nextConfig: NextConfig = {
  // Standalone output for Docker / Cloud Run — bundles only needed deps
  output: "standalone",
  async headers() {
    return [
      {
        // Security headers for all routes
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://clerk.lvlai.app https://challenges.cloudflare.com",
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
              "img-src 'self' data: https:",
              "font-src 'self' data: https://cdn.fontshare.com",
              "connect-src 'self' https://*.clerk.accounts.dev https://clerk.lvlai.app https://api.clerk.com https://api.stedi.com https://api.twilio.com https://challenges.cloudflare.com https://*.sentry.io https://*.ingest.sentry.io",
              "frame-src 'self' https://*.clerk.accounts.dev https://clerk.lvlai.app https://challenges.cloudflare.com",
            ].join("; "),
          },
        ],
      },
      {
        // CORS headers for API routes
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: isProd ? PROD_ORIGIN : "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Webhook-Signature" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry build-time options
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI, // suppress logs in local dev

  // Upload source maps for better stack traces in production
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
