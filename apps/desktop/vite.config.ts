import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { shouldBlockPublicDemoRequest } from "./src/public-demo.ts";

const publicDemoHost = normalizeOptionalHost(process.env.ANECITES_PUBLIC_DEMO_HOST);
const apiProxyTarget = process.env.ANECITES_API_PROXY_TARGET?.trim() || "http://127.0.0.1:3000";
const collabProxyTarget = process.env.ANECITES_COLLAB_PROXY_TARGET?.trim() || "ws://127.0.0.1:3001";
const proxy = {
  "/api": {
    target: apiProxyTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
  "/collab": {
    target: collabProxyTarget,
    changeOrigin: true,
    ws: true,
  },
};

export default defineConfig({
  plugins: [react(), publicDemoRequestGuard(publicDemoHost)],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: publicDemoHost ? [publicDemoHost] : [],
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    allowedHosts: publicDemoHost ? [publicDemoHost] : [],
    proxy,
  },
});

function publicDemoRequestGuard(configuredPublicHost: string | null): Plugin {
  const guard = (
    request: { headers: { host?: string | undefined }; method?: string | undefined; url?: string | undefined },
    response: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(body?: string): void;
    },
    next: () => void,
  ) => {
    if (
      shouldBlockPublicDemoRequest({
        configuredPublicHost,
        hostHeader: request.headers.host,
        method: request.method,
        requestUrl: request.url,
      })
    ) {
      response.statusCode = 403;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: { code: "PUBLIC_DEMO_JOIN_ONLY", message: "Host locally to create an interview" } }));
      return;
    }

    next();
  };

  return {
    name: "anecites-public-demo-request-guard",
    configureServer(server) {
      server.middlewares.use(guard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
    },
  };
}

function normalizeOptionalHost(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) {
    throw new Error("ANECITES_PUBLIC_DEMO_HOST must be a hostname without a scheme or port");
  }

  return normalized;
}
