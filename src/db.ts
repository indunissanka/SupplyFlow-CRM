// MongoDB database utilities (replaces Cloudflare D1 utilities)
import type { MongoDBQueryable, MongoDBPreparedStatement } from './types';

export type D1Queryable = MongoDBQueryable;

type CacheJsonOptions = {
  cacheKey: string;
  ttlSeconds: number;
  data: () => Promise<unknown>;
  request?: any;
  bypass?: boolean;
};

const AUTH_HEADERS = ["authorization", "cookie"];

// MongoDB doesn't have sessions like D1, so this is a no-op
export const getReadSession = (db: any, preferPrimary = false): any => db;

export const batchInChunks = async (
  db: MongoDBQueryable,
  statements: MongoDBPreparedStatement[],
  batchSize = 50
) => {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length) {
      await db.batch(chunk);
    }
  }
};

export const buildCacheRequest = (url: string) => url;

export const shouldBypassCache = (request: any) => {
  if (!request || !request.headers) return false;
  const cacheControl = (request.headers['cache-control'] || "").toLowerCase();
  if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) return true;
  const pragma = (request.headers['pragma'] || "").toLowerCase();
  if (pragma.includes("no-cache")) return true;
  return AUTH_HEADERS.some((header) => request.headers[header]);
};

// Simplified cache implementation for Node.js
export const cacheJson = async ({
  cacheKey,
  ttlSeconds,
  data,
  request,
  bypass
}: CacheJsonOptions) => {
  const canCache = !bypass && (!request || !shouldBypassCache(request));
  
  // In Node.js, we'd use a proper caching library like node-cache
  // For now, just return the data without caching
  const payload = await data();
  return payload;
};
