import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    // Board1 Setup / Fix Me are single-file .bat; .ps1 mirrors are optional.
    // Force text/plain so static script fetches are never MIME-oddities.
    const plain = [
      { key: "Content-Type", value: "text/plain; charset=utf-8" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ];
    return [
      { source: "/Board1-Setup.ps1", headers: plain },
      { source: "/Board1-Setup.ps1.txt", headers: plain },
      { source: "/Board1-FixMe.ps1", headers: plain },
      { source: "/Board1-FixMe.ps1.txt", headers: plain },
    ];
  },
};

export default nextConfig;
