import type { NextConfig } from "next";

/**
 * P1-1f: baseline security headers.
 * - CSP ships Report-Only first; flip to enforced in P3-4 after a clean
 *   report window. The app is canvas-driven (rough.js) with Tailwind inline
 *   styles, so style-src 'unsafe-inline' stays; scripts need 'unsafe-inline'
 *   for Next's inline bootstrap.
 * - Permissions-Policy keeps microphone=(self): the app uses Web Speech for
 *   voice capture.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
]

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // P1-2 note: `tsc --noEmit` now runs in CI/the build and the repo is
    // clean — this escape hatch can be removed in a follow-up.
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
};

export default nextConfig;
