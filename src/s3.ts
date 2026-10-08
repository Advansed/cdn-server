import { createHash, createHmac } from "node:crypto";

const endpoint = required("S3_ENDPOINT").replace(/\/$/, "");
const bucket = required("S3_BUCKET");
const accessKeyId = required("S3_ACCESS_KEY");
const secretAccessKey = required("S3_SECRET_KEY");
const urlStyle = process.env.S3_URL_STYLE || "path";
const defaultRegion = process.env.S3_REGION || "ru-1";

const EMPTY_PAYLOAD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function objectUrl(key: string): string {
  const encoded = key.split("/").map(encodeRfc3986).join("/");
  if (urlStyle === "virtual") {
    const parsed = new URL(endpoint);
    return `${parsed.protocol}//${bucket}.${parsed.host}/${encoded}`;
  }
  return `${endpoint}/${bucket}/${encoded}`;
}

export function s3Fetch(
  url: string,
  init: { method?: string; headers?: Headers; region?: string } = {},
): Promise<Response> {
  const method = init.method || "GET";
  const parsed = new URL(url);
  const region = init.region || defaultRegion;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers = new Map<string, string>();
  init.headers?.forEach((value, name) => {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  });
  headers.set("host", parsed.host);
  headers.set("x-amz-date", amzDate);
  headers.set("x-amz-content-sha256", EMPTY_PAYLOAD);

  const names = [...headers.keys()].sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers.get(name)}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    canonicalUri(parsed.pathname),
    canonicalQuery(parsed),
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(secretAccessKey, dateStamp, region))
    .update(stringToSign)
    .digest("hex");

  const outgoing = new Headers();
  for (const name of names) {
    if (name !== "host") outgoing.set(name, headers.get(name)!);
  }
  outgoing.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return fetch(parsed, { method, headers: outgoing });
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function canonicalUri(pathname: string): string {
  const path = pathname || "/";
  return path
    .split("/")
    .map((segment) => encodeRfc3986(safeDecode(segment)))
    .join("/");
}

function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing env ${name}`);
    process.exit(1);
  }
  return value;
}
