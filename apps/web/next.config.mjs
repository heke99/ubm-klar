/** @type {import('next').NextConfig} */
const isProductionLike = ['stage', 'prod', 'production'].includes(
  (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase(),
);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires inline styles for its runtime; scripts stay self-only.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'" + (isProductionLike ? '' : " 'unsafe-eval'"),
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  },
  ...(isProductionLike
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig = {
  transpilePackages: [
    '@ubm-klar/shared-types',
    '@ubm-klar/access-control',
    '@ubm-klar/auth',
    '@ubm-klar/tenant-resolver',
    '@ubm-klar/rule-engine',
    '@ubm-klar/lss-domain',
    '@ubm-klar/economic-assistance-domain',
    '@ubm-klar/onboarding-engine',
    '@ubm-klar/ubm-eligibility-engine',
    '@ubm-klar/evidence-chain',
    '@ubm-klar/config',
    '@ubm-klar/legal-source-engine',
  ],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // File uploads flow through server actions (base64 to the API).
      bodySizeLimit: '30mb',
    },
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
