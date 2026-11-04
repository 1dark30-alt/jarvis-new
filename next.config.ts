import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  serverExternalPackages: ["@jitsi/robotjs", "screenshot-desktop", "sharp"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*", "10.*", "172.*"],
};

export default nextConfig;
