import { objectUrl, s3Fetch } from "./s3.ts";

const bucket = process.env.S3_BUCKET;
const port = Number(process.env.PORT || 8080);
const hostname = process.env.HOST || "127.0.0.1";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  wasm: "application/wasm",
  map: "application/json",
};

Bun.serve({
  hostname,
  port,
  idleTimeout: 255,
  async fetch(req) {
    const started = Date.now();
    const url = new URL(req.url);

    try {
      const response = await handle(req, url);
      log(req.method, url.pathname, response.status, Date.now() - started);
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          method: req.method,
          path: url.pathname,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      log(req.method, url.pathname, 502, Date.now() - started);
      return text(502, "bad gateway");
    }
  },
});

console.log(`cdn listening on http://${hostname}:${port} -> s3://${bucket}`);

async function handle(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/health") {
    return text(200, "ok", { "cache-control": "no-store" });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders() });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return text(405, "method not allowed", { allow: "GET, HEAD, OPTIONS" });
  }

  const key = objectKey(url.pathname);
  if (key === null) return text(400, "bad request");

  const upstreamHeaders = new Headers();
  copyHeader(req, upstreamHeaders, "range");
  copyHeader(req, upstreamHeaders, "if-range");
  copyHeader(req, upstreamHeaders, "if-none-match");
  copyHeader(req, upstreamHeaders, "if-modified-since");

  const upstream = await s3Fetch(objectUrl(key), {
    method: req.method,
    headers: upstreamHeaders,
  });

  if (upstream.status === 404) return text(404, "not found");
  if (upstream.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders(upstream, key) });
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    const detail = (await upstream.text()).slice(0, 400);
    console.error(
      JSON.stringify({
        level: "upstream",
        key,
        status: upstream.status,
        detail,
      }),
    );
    if (upstream.status === 416) return text(416, "range not satisfiable");
    return text(502, "bad gateway");
  }

  const headers = responseHeaders(upstream, key);
  const body = req.method === "HEAD" ? null : upstream.body;
  return new Response(body, { status: upstream.status, headers });
}

function responseHeaders(upstream: Response, key: string): Headers {
  const headers = baseHeaders();
  const sourceType = upstream.headers.get("content-type");
  headers.set("content-type", resolveType(key, sourceType));
  copyUpstream(upstream, headers, "content-length");
  copyUpstream(upstream, headers, "content-range");
  copyUpstream(upstream, headers, "content-encoding");
  copyUpstream(upstream, headers, "content-disposition");
  copyUpstream(upstream, headers, "etag");
  copyUpstream(upstream, headers, "last-modified");
  headers.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  headers.set("cache-control", cacheControl(key, headers.get("content-type") || ""));
  return headers;
}

function objectKey(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  if (path.split("/").some((part) => part === "..")) return null;

  const directory = path.endsWith("/");
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return "index.html";
  const key = parts.join("/");
  return directory ? `${key}/index.html` : key;
}

function resolveType(key: string, sourceType: string | null): string {
  const generic = !sourceType || sourceType === "application/octet-stream" || sourceType === "binary/octet-stream";
  if (!generic) return sourceType;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] || "application/octet-stream";
}

function cacheControl(key: string, contentType: string): string {
  if (/\.[a-f0-9]{8,}\.[a-z0-9]+$/i.test(key)) {
    return "public, max-age=31536000, immutable";
  }
  if (contentType.startsWith("text/html")) return "public, max-age=60";
  if (/^(image|font|video|audio)\//.test(contentType)) return "public, max-age=2592000";
  return "public, max-age=86400";
}

function baseHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-expose-headers": "Content-Length, Content-Range, ETag, Accept-Ranges, Content-Type",
    "x-content-type-options": "nosniff",
  });
}

function copyHeader(from: Request, to: Headers, name: string) {
  const value = from.headers.get(name);
  if (value) to.set(name, value);
}

function copyUpstream(from: Response, to: Headers, name: string) {
  const value = from.headers.get(name);
  if (value) to.set(name, value);
}

function text(status: number, message: string, extra?: Record<string, string>): Response {
  const headers = baseHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", status >= 500 || status === 200 ? "no-store" : "public, max-age=60");
  if (extra) {
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  }
  return new Response(status === 204 ? null : `${message}\n`, { status, headers });
}

function log(method: string, path: string, status: number, ms: number) {
  console.log(JSON.stringify({ method, path, status, ms }));
}
