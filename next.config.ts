import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the source panel controls; the route
  // overlay is still available via the browser devtools.
  devIndicators: false,
  // resvg ships a platform-specific native binary, which the bundler cannot
  // inline. Loading it from node_modules at runtime keeps the SVG rasteriser
  // used by the video export working.
  serverExternalPackages: ['@resvg/resvg-js'],
  outputFileTracingIncludes: {
    // The sample document is read from disk by /api/sample at runtime.
    '/api/sample': ['./samples/**'],
  },
};

export default nextConfig;
