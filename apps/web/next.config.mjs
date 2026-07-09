/** @type {import('next').NextConfig} */
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
};

export default nextConfig;
