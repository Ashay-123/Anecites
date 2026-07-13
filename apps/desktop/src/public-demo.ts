export interface PublicDemoRequestGuardInput {
  configuredPublicHost: string | null;
  hostHeader: string | undefined;
  method: string | undefined;
  requestUrl: string | undefined;
}

export function canHostLocalDemo(pageUrl: string | null): boolean {
  if (!pageUrl) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return true;
  }

  return isLoopbackHostname(url.hostname);
}

export function shouldBlockPublicDemoRequest({
  configuredPublicHost,
  hostHeader,
  method,
  requestUrl,
}: PublicDemoRequestGuardInput): boolean {
  if (!configuredPublicHost || normalizeHost(hostHeader) !== configuredPublicHost.toLowerCase()) {
    return false;
  }

  let pathname: string;
  try {
    pathname = new URL(requestUrl ?? "/", "http://public-demo.internal").pathname;
  } catch {
    return true;
  }

  return (
    method?.toUpperCase() === "POST" &&
    (pathname === "/api/local-demo/meetings" || pathname === "/api/local-demo/meetings/")
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function normalizeHost(hostHeader: string | undefined): string | null {
  const normalized = hostHeader?.trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(`http://${normalized}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}
