import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**/*": ["./drizzle/**/*"],
  },
};

export default nextConfig;
