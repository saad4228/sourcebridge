import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the source panel controls; the route
  // overlay is still available via the browser devtools.
  devIndicators: false,
  outputFileTracingIncludes: {
    // The sample document is read from disk by /api/sample at runtime.
    '/api/sample': ['./samples/**'],
  },
};

export default nextConfig;
