// Type definitions for MongoDB-based CRM application
// Replaces Cloudflare-specific types (D1Database, R2Bucket, KVNamespace, Ai, etc.)

export interface MongoDBDatabase {
  collection(name: string): any;
}

export interface MongoDBBucket {
  // Placeholder for file storage - could be S3, local filesystem, etc.
  put(key: string, value: Buffer | string, options?: any): Promise<any>;
  get(key: string): Promise<any>;
  delete(key: string): Promise<any>;
}

export interface MongoDBKVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
}

// MongoDB queryable interface (replaces D1Queryable)
export interface MongoDBQueryable {
  prepare(query: string, ...params: any[]): MongoDBPreparedStatement;
  batch(statements: MongoDBPreparedStatement[]): Promise<any[]>;
}

export interface MongoDBPreparedStatement {
  operation: string;
  collection: string;
  query?: any;
  document?: any;
  documents?: any[];
  filter?: any;
  update?: any;
  options?: any;
  pipeline?: any[];
}

// Environment type for the application
export type Env = {
  DB: MongoDBDatabase;
  FILES: MongoDBBucket;
  ASSETS: any; // Fetcher type not needed in Node.js
  CACHE: MongoDBKVNamespace;
  SHIPPO_API_KEY?: string;
  AUTH_SECRET: string;
  ALLOWED_ORIGINS?: string;
  DEBUG_ERRORS?: string;
};

// Helper types for analytics
export interface ForecastMetric {
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

// User row type
export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  password_hash: string;
  salt: string;
  created_at: string;
  updated_at: string;
  access_list?: string;
}