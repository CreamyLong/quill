/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

function getInternalServiceURL(envKey, fallbackURL) {
  const configured = process.env[envKey]?.trim();
  return configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : fallbackURL;
}
import nextra from "nextra";

const withNextra = nextra({});

/** @type {import("next").NextConfig} */
const config = {
  distDir: ".quill-dist",
  output:
    process.env.NEXT_CONFIG_BUILD_OUTPUT === "standalone"
      ? "standalone"
      : undefined,
  i18n: {
    locales: ["en", "zh"],
    defaultLocale: "en",
  },
  devIndicators: false,
  async rewrites() {
    const rewrites = [];
    const gatewayURL = getInternalServiceURL(
      "QUILL_INTERNAL_GATEWAY_BASE_URL",
      "http://127.0.0.1:8101",
    );

    // Always proxy /api/langgraph to the gateway (dev-mode rewrite).
    // The NEXT_PUBLIC_LANGGRAPH_BASE_URL env var controls only the
    // LangGraph SDK client-side connection; rewrites handle the rest.
    rewrites.push({
      source: "/api/langgraph",
      destination: `${gatewayURL}/api`,
    });
    rewrites.push({
      source: "/api/langgraph/:path*",
      destination: `${gatewayURL}/api/:path*`,
    });

    // Always proxy standard API routes to the gateway. The NEXT_PUBLIC_BACKEND_BASE_URL
    // env var controls direct fetch() calls, but rewrites cover relative URLs.
    rewrites.push({
      source: "/api/agents",
      destination: `${gatewayURL}/api/agents`,
    });
    rewrites.push({
      source: "/api/agents/:path*",
      destination: `${gatewayURL}/api/agents/:path*`,
    });
    rewrites.push({
      source: "/api/skills",
      destination: `${gatewayURL}/api/skills`,
    });
    rewrites.push({
      source: "/api/skills/:path*",
      destination: `${gatewayURL}/api/skills/:path*`,
    });

    // Catch-all for remaining gateway API routes (models, threads, memory,
    // mcp, artifacts, uploads, suggestions, runs, etc.) that don't have
    // their own NEXT_PUBLIC_* env var toggle.
    rewrites.push({
      source: "/api/:path*",
      destination: `${gatewayURL}/api/:path*`,
    });

    return rewrites;
  },
};

export default withNextra(config);
