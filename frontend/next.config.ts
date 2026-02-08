import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/**" },
    ],
  },
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: false }];
  },
};

export default nextConfig;
