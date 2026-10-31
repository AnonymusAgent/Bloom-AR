import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@lowlysre/icd-10-cm"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./drizzle/**/*",
      "./node_modules/@lowlysre/icd-10-cm/data/**/*",
      "./src/lib/coding/data/**/*",
    ],
  },
};

export default nextConfig;

