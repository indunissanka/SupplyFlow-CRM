export type D1Queryable = Pick<D1Database, "prepare" | "batch">;

type CacheJsonOptions = {
  cacheKey: Request;
  ttlSeconds: number;
  data: () => Promise<unknown>;
  request?: Request;
  bypass?: boolean;
};

const AUTH_HEADERS = ["authorization", "cookie", "cf-access-jwt-assertion"];

export const getReadSession = (db: D1Database, preferPrimary = false): D1DatabaseSession =>
  db.withSession(preferPrimary ? "first-primary" : "first-unconstrained");

export const batchInChunks = async (
  db: D1Queryable,
  statements: D1PreparedStatement[],
  batchSize = 50
) => {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length) {
      await db.batch(chunk);
    }
  }
};

export const buildCacheRequest = (url: string) => new Request(url, { method: "GET" });

export const shouldBypassCache = (request: Request) => {
  const cacheControl = (request.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) return true;
  const pragma = (request.headers.get("pragma") || "").toLowerCase();
  if (pragma.includes("no-cache")) return true;
  return AUTH_HEADERS.some((header) => request.headers.has(header));
};

export const cacheJson = async ({
  cacheKey,
  ttlSeconds,
  data,
  request,
  bypass
}: CacheJsonOptions) => {
  const canCache = !bypass && (!request || !shouldBypassCache(request));
  if (canCache) {
    const cache = await caches.open('default');
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const payload = await data();
  const headers = new Headers({ "content-type": "application/json" });
  if (canCache) {
    headers.set("cache-control", `max-age=${ttlSeconds}`);
  } else {
    headers.set("cache-control", "no-store");
  }
  const response = new Response(JSON.stringify(payload), { headers });
  if (canCache) {
    const cache = await caches.open('default');
    await cache.put(cacheKey, response.clone());
  }
  return response;
};
