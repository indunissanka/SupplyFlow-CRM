import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { batchInChunks, buildCacheRequest, cacheJson, getReadSession } from "./db";
import {
  buildForecast,
  fillSeries,
  getBreakdown,
  getDataQuality,
  getForecastSeries,
  getKpis,
  getTimeSeries,
  parseAnalyticsFilters,
  parseDateRange,
  type ForecastMetric
} from "./analytics";
import type { D1Queryable } from "./db";

type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  AI: Ai;
  SHIPPO_API_KEY?: string;
  AUTH_SECRET: string;
  ALLOWED_ORIGINS?: string;
  AI_MODEL?: string;
  DEBUG_ERRORS?: string;
};

const allowedTables = [
  "companies",
  "contacts",
  "products",
  "orders",
  "quotations",
  "invoices",
  "documents",
  "shipping_schedules",
  "sample_shipments",
  "tasks",
  "notes",
  "tags",
  "doc_types",
  "quotation_items"
];

const backupTables = [
  "companies",
  "contacts",
  "products",
  "orders",
  "quotations",
  "invoices",
  "documents",
  "shipping_schedules",
  "sample_shipments",
  "tasks",
  "notes",
  "tags",
  "tag_links",
  "doc_types",
  "quotation_items",
  "site_config",
  "users"
];

const cacheableTables = new Set<string>([
  "companies",
  "contacts",
  "products",
  "orders",
  "quotations",
  "invoices",
  "documents",
  "shipping_schedules",
  "sample_shipments",
  "tasks",
  "notes",
  "tags",
  "doc_types",
  "quotation_items",
  "site_config"
]);

const CACHE_TTL_SECONDS = 20;
const DASHBOARD_CACHE_TTL_SECONDS = 15;
const SITE_CONFIG_CACHE_TTL_SECONDS = 20;
const ANALYTICS_CACHE_TTL_SECONDS = 20;
const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 12;
const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const TAGGED_LIST_TABLES = ["orders", "quotations", "documents"];
const DOC_TYPE_LIST_TABLES = ["doc_types", "documents"];
const CACHEABLE_TABLES_LIST = Array.from(cacheableTables.values());
const AI_DEFAULT_MODEL = "@cf/meta/llama-3-8b-instruct";
const AI_DEFAULT_TABLES = ["companies", "contacts", "orders", "quotations", "invoices", "tasks", "notes"];
const AI_MAX_TABLES = 8;
const AI_MAX_TABLE_ROWS = 10;
const AI_MAX_QUESTION_LENGTH = 2000;
const AI_TEXT_TRUNCATE = 400;
const adminRole = "Admin";
const salesRole = "Salesperson";
const defaultAccessList = [
  "tags",
  "companies",
  "contacts",
  "products",
  "pricing",
  "analytics",
  "orders",
  "quotations",
  "invoices",
  "documents",
  "shipping",
  "sample_shipments",
  "tasks",
  "notes",
  "settings"
];

const shouldIncludeErrorDetail = (c: Context) => {
  if (c.env.DEBUG_ERRORS === "true") return true;
  try {
    const host = new URL(c.req.url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return false;
  }
};

const ownerEmailTables = [
  "companies",
  "contacts",
  "products",
  "orders",
  "quotations",
  "quotation_items",
  "invoices",
  "documents",
  "shipping_schedules",
  "sample_shipments",
  "tasks",
  "notes",
  "tags",
  "doc_types",
  "tag_links",
  "site_config"
];

const accessByTable: Record<string, string> = {
  companies: "companies",
  contacts: "contacts",
  products: "products",
  orders: "orders",
  quotations: "quotations",
  invoices: "invoices",
  documents: "documents",
  shipping_schedules: "shipping",
  sample_shipments: "sample_shipments",
  tasks: "tasks",
  notes: "notes",
  tags: "tags",
  doc_types: "tags",
  quotation_items: "quotations"
};

const allowedUploadContentTypes = new Set<string>([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

const updatableFields: Record<string, string[]> = {
  companies: ["name", "website", "email", "phone", "owner", "industry", "status", "address", "updated_at", "company_code"],
  contacts: ["company_id", "first_name", "last_name", "email", "phone", "role", "status"],
  products: ["name", "sku", "category", "price", "currency", "status", "description"],
  orders: ["company_id", "contact_id", "quotation_id", "invoice_ids", "status", "total_amount", "currency", "reference"],
  quotations: [
    "company_id",
    "contact_id",
    "reference",
    "amount",
    "currency",
    "exchange_rate",
    "status",
    "valid_until",
    "title",
    "tax_rate",
    "notes",
    "bank_charge_method",
    "attachment_key"
  ],
  invoices: ["company_id", "contact_id", "reference", "total_amount", "currency", "due_date", "status", "attachment_key"],
  documents: ["company_id", "contact_id", "invoice_id", "doc_type_id", "title", "content_type", "size"],
  shipping_schedules: [
    "order_id",
    "invoice_id",
    "company_id",
    "carrier",
    "tracking_number",
    "factory_exit_date",
    "etc_date",
    "etd_date",
    "eta",
    "status",
    "notes"
  ],
  sample_shipments: [
    "company_id",
    "product_id",
    "document_id",
    "receiving_address",
    "phone",
    "quantity",
    "waybill_number",
    "courier",
    "status",
    "notes"
  ],
  tasks: ["title", "status", "due_date", "assignee", "related_type", "related_id"],
  notes: ["entity_type", "entity_id", "body", "author", "note_date"],
  tags: ["name", "color"],
  doc_types: ["name"]
};

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'"
].join("; ");

const entityTypes: Record<string, string> = {
  companies: "company",
  contacts: "contact",
  products: "product",
  orders: "order",
  quotations: "quotation",
  invoices: "invoice",
  documents: "document",
  shipping_schedules: "shipping",
  sample_shipments: "sample_shipment",
  tasks: "task",
  notes: "note"
};

const tableColumns: Record<string, string[]> = {
  companies: [
    "id",
    "owner_email",
    "name",
    "company_code",
    "website",
    "email",
    "phone",
    "address",
    "owner",
    "industry",
    "status",
    "created_at",
    "updated_at"
  ],
  contacts: [
    "id",
    "owner_email",
    "company_id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "role",
    "status",
    "created_at",
    "updated_at"
  ],
  products: [
    "id",
    "owner_email",
    "name",
    "sku",
    "category",
    "price",
    "currency",
    "status",
    "description",
    "created_at",
    "updated_at"
  ],
  orders: [
    "id",
    "owner_email",
    "company_id",
    "contact_id",
    "quotation_id",
    "invoice_ids",
    "status",
    "total_amount",
    "currency",
    "reference",
    "created_at",
    "updated_at"
  ],
  quotations: [
    "id",
    "owner_email",
    "company_id",
    "contact_id",
    "reference",
    "amount",
    "currency",
    "exchange_rate",
    "status",
    "valid_until",
    "title",
    "tax_rate",
    "notes",
    "bank_charge_method",
    "attachment_key",
    "created_at",
    "updated_at"
  ],
  invoices: [
    "id",
    "owner_email",
    "company_id",
    "contact_id",
    "reference",
    "total_amount",
    "currency",
    "due_date",
    "status",
    "attachment_key",
    "created_at",
    "updated_at"
  ],
  documents: [
    "id",
    "owner_email",
    "company_id",
    "contact_id",
    "invoice_id",
    "doc_type_id",
    "title",
    "storage_key",
    "content_type",
    "size",
    "created_at",
    "updated_at"
  ],
  shipping_schedules: [
    "id",
    "owner_email",
    "order_id",
    "invoice_id",
    "company_id",
    "carrier",
    "tracking_number",
    "factory_exit_date",
    "etc_date",
    "etd_date",
    "eta",
    "status",
    "notes",
    "created_at",
    "updated_at"
  ],
  sample_shipments: [
    "id",
    "owner_email",
    "company_id",
    "product_id",
    "document_id",
    "receiving_address",
    "phone",
    "quantity",
    "waybill_number",
    "courier",
    "status",
    "notes",
    "created_at",
    "updated_at"
  ],
  tasks: [
    "id",
    "owner_email",
    "title",
    "status",
    "due_date",
    "assignee",
    "related_type",
    "related_id",
    "created_at",
    "updated_at"
  ],
  notes: [
    "id",
    "owner_email",
    "entity_type",
    "entity_id",
    "body",
    "author",
    "note_date",
    "created_at",
    "updated_at"
  ],
  tags: ["id", "owner_email", "name", "color", "created_at"],
  tag_links: ["id", "owner_email", "tag_id", "entity_type", "entity_id", "created_at"],
  doc_types: ["id", "owner_email", "name", "created_at"],
  site_config: [
    "owner_email",
    "site_name",
    "base_company",
    "region",
    "timezone",
    "theme",
    "active_theme",
    "invoice_name",
    "invoice_address",
    "invoice_phone",
    "show_footer",
    "ai_provider",
    "ai_api_url",
    "ai_api_key",
    "ai_model",
    "updated_at"
  ],
  users: [
    "id",
    "email",
    "name",
    "role",
    "access",
    "access_list",
    "password_hash",
    "password_salt",
    "enabled",
    "created_at",
    "updated_at"
  ],
  quotation_items: [
    "id",
    "owner_email",
    "quotation_id",
    "product_id",
    "product_name",
    "qty",
    "unit_price",
    "drums_price",
    "bank_charge_price",
    "shipping_price",
    "customer_commission",
    "line_total",
    "created_at"
  ]
};

const filterableFields: Record<string, string[]> = {
  companies: ["status", "name", "company_code"],
  contacts: ["company_id", "status", "email", "last_name"],
  products: ["status", "category", "sku"],
  orders: ["company_id", "contact_id", "status", "reference"],
  quotations: ["company_id", "contact_id", "status", "reference"],
  invoices: ["company_id", "contact_id", "status", "reference"],
  documents: ["company_id", "contact_id", "invoice_id", "doc_type_id", "title"],
  shipping_schedules: ["order_id", "invoice_id", "company_id", "status", "carrier"],
  sample_shipments: ["company_id", "product_id", "document_id", "status", "courier"],
  tasks: ["status", "assignee", "related_type", "related_id"],
  notes: ["entity_type", "entity_id", "author"],
  tags: ["name"],
  doc_types: ["name"],
  quotation_items: ["quotation_id", "product_id"]
};

const searchableFields: Record<string, string[]> = {
  companies: ["name", "company_code", "email", "phone", "website", "owner", "industry", "status", "address"],
  contacts: ["first_name", "last_name", "email", "phone", "role", "status"],
  products: ["name", "sku", "category", "status", "description"],
  orders: ["reference", "status", "currency"],
  quotations: ["reference", "title", "status"],
  invoices: ["reference", "status"],
  documents: ["title", "storage_key"],
  shipping_schedules: ["tracking_number", "carrier", "status", "notes"],
  sample_shipments: ["waybill_number", "courier", "status", "receiving_address", "notes"],
  tasks: ["title", "status", "assignee"],
  notes: ["body", "author"],
  tags: ["name"],
  doc_types: ["name"]
};

const selectColumns = (alias: string, columns: string[]) => columns.map((col) => `${alias}.${col}`).join(", ");

const parseFilters = (table: string, searchParams: URLSearchParams) => {
  const allowed = filterableFields[table] ?? [];
  const result: Array<{ column: string; value: string | number }> = [];
  for (const field of allowed) {
    const raw = searchParams.get(field);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (field.endsWith("_id") || field === "related_id" || field === "entity_id") {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) continue;
      result.push({ column: field, value: numeric });
    } else {
      result.push({ column: field, value: trimmed });
    }
  }
  return result;
};

const buildFilterKey = (filters: Array<{ column: string; value: string | number }>) => {
  if (!filters.length) return "none";
  const parts = filters.map((filter) => `${filter.column}=${filter.value}`).sort();
  return encodeURIComponent(parts.join("&"));
};

const cacheVersionKey = (ownerEmail: string, table: string) =>
  `cache:v1:${ownerEmail}:${table}`;

const buildCacheKey = (
  ownerEmail: string,
  table: string,
  filterKey: string,
  version: string,
  limit: number,
  offset: number
) => {
  const owner = encodeURIComponent(ownerEmail);
  return `https://cache.local/api/${table}?owner=${owner}&filters=${filterKey}&v=${version}&limit=${limit}&offset=${offset}`;
};

const buildWhereClause = (
  ownerEmail: string,
  filters: Array<{ column: string; value: string | number }>,
  alias?: string
) => {
  const prefix = alias ? `${alias}.` : "";
  const parts = [`${prefix}owner_email = ?`];
  const params: Array<string | number> = [ownerEmail];
  for (const filter of filters) {
    parts.push(`${prefix}${filter.column} = ?`);
    params.push(filter.value);
  }
  return { clause: parts.join(" AND "), params };
};

const getSearchOrderColumn = (table: string) => {
  const columns = tableColumns[table] ?? [];
  if (columns.includes("updated_at")) return "updated_at";
  if (columns.includes("note_date")) return "note_date";
  return "created_at";
};

const getBackupOrderColumn = (table: string) => {
  const columns = tableColumns[table] ?? [];
  if (columns.includes("id")) return "id";
  if (columns.includes("created_at")) return "created_at";
  if (columns.includes("updated_at")) return "updated_at";
  if (columns.includes("owner_email")) return "owner_email";
  return "rowid";
};

type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const base64UrlEncode = (data: Uint8Array) => {
  let base64 = "";
  if (typeof btoa === "function") {
    base64 = btoa(String.fromCharCode(...data));
  } else {
    // Fallback using TextEncoder if btoa is not available
    const binary = Array.from(data).map(byte => String.fromCharCode(byte)).join('');
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const base64 = `${normalized}${pad}`;
  if (typeof atob === "function") {
    const decoded = atob(base64);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }
  throw new Error("Base64 decoder unavailable");
};

let cachedJwtKey: CryptoKey | null = null;
let cachedJwtSecret: string | null = null;

const getJwtKey = async (secret: string) => {
  if (cachedJwtKey && cachedJwtSecret === secret) return cachedJwtKey;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedJwtKey = key;
  cachedJwtSecret = secret;
  return key;
};

const signJwt = async (payload: JwtPayload, secret: string) => {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", await getJwtKey(secret), new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const verifyJwt = async (token: string, secret: string) => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const signatureBytes = base64UrlDecode(signature);
  const valid = await crypto.subtle.verify(
    "HMAC",
    await getJwtKey(secret),
    signatureBytes,
    new TextEncoder().encode(data)
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as JwtPayload;
    if (!payload?.sub || typeof payload.sub !== "string") return null;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
};

const parseAllowedOrigins = (raw?: string) =>
  (raw || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const isOriginAllowed = (origin: string, requestOrigin: string, allowlist: string[]) => {
  if (allowlist.includes("*")) return true;
  if (!allowlist.length) return origin === requestOrigin;
  return allowlist.includes(origin);
};

const normalizeContentType = (value?: string | null) => {
  const trimmed = (value || "").split(";")[0]?.trim().toLowerCase();
  return trimmed || "application/octet-stream";
};

const applySecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  Object.entries(securityHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  const contentType = headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    headers.set("content-security-policy", contentSecurityPolicy);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const checkRateLimit = async (kv: KVNamespace, key: string) => {
  const now = Date.now();
  const raw = await kv.get(key);
  let state: { count: number; reset: number } | null = null;
  if (raw) {
    try {
      state = JSON.parse(raw) as { count: number; reset: number };
    } catch {
      state = null;
    }
  }
  if (!state || typeof state !== "object" || now > state.reset) {
    state = { count: 0, reset: now + LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000 };
  }
  state.count += 1;
  const ttl = Math.max(1, Math.ceil((state.reset - now) / 1000));
  await kv.put(key, JSON.stringify(state), { expirationTtl: ttl });
  const allowed = state.count <= LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
  return { allowed, retryAfter: ttl, remaining: Math.max(0, LOGIN_RATE_LIMIT_MAX_ATTEMPTS - state.count) };
};

type SiteConfigPayload = {
  siteName?: string;
  baseCompany?: string;
  region?: string;
  timezone?: string;
  theme?: string;
  activeTheme?: string;
  invoiceName?: string;
  invoiceAddress?: string;
  invoicePhone?: string;
  showFooter?: boolean | number | string;
  aiProvider?: string;
  aiApiUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
};

const normalizeConfigText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

type AiProvider = "cloudflare" | "custom";

const normalizeAiProvider = (value: unknown): AiProvider => {
  if (typeof value !== "string") return "cloudflare";
  const normalized = value.trim().toLowerCase();
  return normalized === "custom" ? "custom" : "cloudflare";
};

const coerceBoolean = (value: unknown, fallback = true) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(normalized)) return true;
    if (["false", "0", "off", "no"].includes(normalized)) return false;
  }
  return fallback;
};

async function getSiteConfig(db: D1Queryable, ownerEmail: string) {
  const row = await db
    .prepare(
      `SELECT site_name, base_company, region, timezone, theme, active_theme,
              invoice_name, invoice_address, invoice_phone, show_footer,
              ai_provider, ai_api_url, ai_api_key, ai_model
       FROM site_config
       WHERE owner_email = ?`
    )
    .bind(ownerEmail)
    .first<{
      site_name: string | null;
      base_company: string | null;
      region: string | null;
      timezone: string | null;
      theme: string | null;
      active_theme: string | null;
      invoice_name: string | null;
      invoice_address: string | null;
      invoice_phone: string | null;
      show_footer: number | null;
      ai_provider: string | null;
      ai_api_url: string | null;
      ai_api_key: string | null;
      ai_model: string | null;
    }>();

  if (!row) return null;
  const hasAiKey = typeof row.ai_api_key === "string" && row.ai_api_key.trim().length > 0;
  return {
    siteName: row.site_name ?? "",
    baseCompany: row.base_company ?? "",
    region: row.region ?? "",
    timezone: row.timezone ?? "",
    theme: row.theme ?? "",
    activeTheme: row.active_theme ?? "",
    invoiceName: row.invoice_name ?? "",
    invoiceAddress: row.invoice_address ?? "",
    invoicePhone: row.invoice_phone ?? "",
    showFooter: row.show_footer === null ? undefined : row.show_footer === 1,
    aiProvider: normalizeAiProvider(row.ai_provider),
    aiApiUrl: row.ai_api_url ?? "",
    aiModel: row.ai_model ?? "",
    aiKeySet: hasAiKey
  };
}

type AiConfig = {
  provider: AiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
};

async function getAiConfig(db: D1Queryable, ownerEmail: string): Promise<AiConfig> {
  const row = await db
    .prepare("SELECT ai_provider, ai_api_url, ai_api_key, ai_model FROM site_config WHERE owner_email = ?")
    .bind(ownerEmail)
    .first<{
      ai_provider: string | null;
      ai_api_url: string | null;
      ai_api_key: string | null;
      ai_model: string | null;
    }>();

  return {
    provider: normalizeAiProvider(row?.ai_provider),
    apiUrl: row?.ai_api_url?.trim() ?? "",
    apiKey: row?.ai_api_key ?? "",
    model: row?.ai_model?.trim() ?? ""
  };
}

const resolveAiModel = (config: AiConfig, env: Env) => {
  if (config.provider === "custom") {
    return config.model;
  }
  return config.model || env.AI_MODEL || AI_DEFAULT_MODEL;
};

async function runCustomAiRequest(
  config: AiConfig,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { maxTokens: number; temperature: number }
) {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(config.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Custom AI request failed (${res.status}): ${rawText.slice(0, 200)}`);
  }

  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { text: rawText, model };
  }

  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const messageText =
    choice?.message?.content ??
    choice?.text ??
    data?.output_text ??
    data?.response ??
    data?.text ??
    "";
  const text = typeof messageText === "string" ? messageText : JSON.stringify(messageText);
  return { text: text || rawText, model: data?.model || model };
}

async function upsertSiteConfig(db: D1Database, ownerEmail: string, payload: SiteConfigPayload) {
  const siteName = normalizeConfigText(payload.siteName);
  const baseCompany = normalizeConfigText(payload.baseCompany);
  const region = normalizeConfigText(payload.region);
  const timezone = normalizeConfigText(payload.timezone);
  const theme = normalizeConfigText(payload.theme);
  const activeTheme = normalizeConfigText(payload.activeTheme);
  const invoiceName = normalizeConfigText(payload.invoiceName);
  const invoiceAddress = normalizeConfigText(payload.invoiceAddress);
  const invoicePhone = normalizeConfigText(payload.invoicePhone);
  const showFooter = coerceBoolean(payload.showFooter, true);
  const needsAiDefaults =
    payload.aiProvider === undefined ||
    payload.aiApiUrl === undefined ||
    payload.aiApiKey === undefined ||
    payload.aiModel === undefined;
  const existingAi = needsAiDefaults
    ? await db
      .prepare("SELECT ai_provider, ai_api_url, ai_api_key, ai_model FROM site_config WHERE owner_email = ?")
      .bind(ownerEmail)
      .first<{ ai_provider?: string | null; ai_api_url?: string | null; ai_api_key?: string | null; ai_model?: string | null }>()
    : null;

  const aiProvider = payload.aiProvider === undefined
    ? normalizeAiProvider(existingAi?.ai_provider)
    : normalizeAiProvider(payload.aiProvider);
  const aiApiUrl = payload.aiApiUrl === undefined
    ? existingAi?.ai_api_url ?? ""
    : normalizeConfigText(payload.aiApiUrl);
  const aiModel = payload.aiModel === undefined
    ? existingAi?.ai_model ?? ""
    : normalizeConfigText(payload.aiModel);
  const aiApiKey = payload.aiApiKey === undefined
    ? existingAi?.ai_api_key ?? null
    : normalizeConfigText(payload.aiApiKey);

  await db
    .prepare(
      `INSERT INTO site_config (
        owner_email,
        site_name,
        base_company,
        region,
        timezone,
        theme,
        active_theme,
        invoice_name,
        invoice_address,
        invoice_phone,
        show_footer,
        ai_provider,
        ai_api_url,
        ai_api_key,
        ai_model,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(owner_email) DO UPDATE SET
        site_name = excluded.site_name,
        base_company = excluded.base_company,
        region = excluded.region,
        timezone = excluded.timezone,
        theme = excluded.theme,
        active_theme = excluded.active_theme,
        invoice_name = excluded.invoice_name,
        invoice_address = excluded.invoice_address,
        invoice_phone = excluded.invoice_phone,
        show_footer = excluded.show_footer,
        ai_provider = excluded.ai_provider,
        ai_api_url = excluded.ai_api_url,
        ai_api_key = excluded.ai_api_key,
        ai_model = excluded.ai_model,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(
      ownerEmail,
      siteName,
      baseCompany,
      region,
      timezone,
      theme,
      activeTheme,
      invoiceName,
      invoiceAddress,
      invoicePhone,
      showFooter ? 1 : 0,
      aiProvider,
      aiApiUrl,
      aiApiKey,
      aiModel
    )
    .run();

  return {
    siteName,
    baseCompany,
    region,
    timezone,
    theme,
    activeTheme,
    invoiceName,
    invoiceAddress,
    invoicePhone,
    showFooter,
    aiProvider,
    aiApiUrl,
    aiModel,
    aiKeySet: !!(aiApiKey && aiApiKey.trim().length)
  };
}

const bumpCacheVersion = async (env: Env, ownerEmail: string, table: string) => {
  if (!cacheableTables.has(table)) return;
  await env.CACHE.put(cacheVersionKey(ownerEmail, table), String(Date.now()));
};

const bumpCacheVersions = async (env: Env, ownerEmail: string, tables: string[]) => {
  if (!tables.length) return;
  await Promise.all(tables.map((table) => bumpCacheVersion(env, ownerEmail, table)));
};

const shippingStatusRank: Record<string, number> = {
  "Factory exit": 1,
  "Dispatched": 2,
  "Cut Off": 3,
  "Shipped": 4,
  "Delivered": 5
};

const shippoCarrierMap: Record<string, string> = {
  dhl: "dhl_express",
  "dhl express": "dhl_express",
  "dhl ecommerce": "dhl_ecommerce",
  fedex: "fedex",
  "fedex express": "fedex",
  ups: "ups",
  "sf express": "sf_express",
  aramex: "aramex",
  "royal mail": "royal_mail"
};

const resolveShippoCarrier = (value?: string | null) => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  return shippoCarrierMap[normalized] || normalized;
};

const schemaStatements = [
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    company_code TEXT,
    website TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    owner TEXT,
    industry TEXT,
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,
    status TEXT DEFAULT 'Engaged',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    category TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'Active',
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    quotation_id INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
    invoice_ids TEXT,
    status TEXT DEFAULT 'Pending',
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    reference TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    reference TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    exchange_rate REAL,
    status TEXT DEFAULT 'Draft',
    valid_until TEXT,
    title TEXT,
    tax_rate REAL DEFAULT 0,
    notes TEXT,
    bank_charge_method TEXT,
    attachment_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    reference TEXT,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    due_date TEXT,
    status TEXT DEFAULT 'Open',
    attachment_key TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    doc_type_id INTEGER REFERENCES doc_types(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    storage_key TEXT UNIQUE NOT NULL,
    content_type TEXT,
    size INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS shipping_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    carrier TEXT,
    tracking_number TEXT,
    factory_exit_date TEXT,
    etc_date TEXT,
    etd_date TEXT,
    eta TEXT,
    status TEXT DEFAULT 'Factory exit',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sample_shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    receiving_address TEXT,
    phone TEXT,
    quantity REAL DEFAULT 0,
    waybill_number TEXT,
    courier TEXT,
    status TEXT DEFAULT 'Preparing',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'Not Started',
    due_date TEXT,
    assignee TEXT,
    related_type TEXT,
    related_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    body TEXT NOT NULL,
    author TEXT,
    note_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS quotation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT,
    qty REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    drums_price REAL DEFAULT 0,
    bank_charge_price REAL DEFAULT 0,
    shipping_price REAL DEFAULT 0,
    customer_commission REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2563eb',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS doc_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS tag_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tag_id, entity_type, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT DEFAULT 'Admin',
    access TEXT,
    access_list TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS site_config (
    owner_email TEXT PRIMARY KEY,
    site_name TEXT,
    base_company TEXT,
    region TEXT,
    timezone TEXT,
    theme TEXT,
    active_theme TEXT,
    invoice_name TEXT,
    invoice_address TEXT,
    invoice_phone TEXT,
    show_footer INTEGER DEFAULT 1,
    ai_provider TEXT,
    ai_api_url TEXT,
    ai_api_key TEXT,
    ai_model TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact_id)",
  "CREATE INDEX IF NOT EXISTS idx_orders_quotation ON orders(quotation_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotations_contact ON quotations(contact_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id)",
  "CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_docs_contact ON documents(contact_id)",
  "CREATE INDEX IF NOT EXISTS idx_docs_invoice ON documents(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_docs_doc_type ON documents(doc_type_id)",
  "CREATE INDEX IF NOT EXISTS idx_shipping_order ON shipping_schedules(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_shipping_invoice ON shipping_schedules(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_shipping_company ON shipping_schedules(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_sample_shipments_company ON sample_shipments(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_sample_shipments_product ON sample_shipments(product_id)",
  "CREATE INDEX IF NOT EXISTS idx_sample_shipments_document ON sample_shipments(document_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotation_items_product ON quotation_items(product_id)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
  "CREATE INDEX IF NOT EXISTS idx_companies_owner_updated ON companies(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_contacts_owner_updated ON contacts(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_owner_updated ON orders(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_quotations_owner_updated ON quotations(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_owner_updated ON invoices(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_shipping_owner_updated ON shipping_schedules(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_sample_shipments_owner_updated ON sample_shipments(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated ON tasks(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes(owner_email, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_companies_owner_status_updated ON companies(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_contacts_owner_status_updated ON contacts(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_products_owner_status_updated ON products(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_owner_status_updated ON orders(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_quotations_owner_status_updated ON quotations(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_owner_status_updated ON invoices(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_shipping_owner_status_updated ON shipping_schedules(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_sample_shipments_owner_status_updated ON sample_shipments(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_owner_status_updated ON tasks(owner_email, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_owner_assignee ON tasks(owner_email, assignee)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_owner_related ON tasks(owner_email, related_type, related_id)",
  "CREATE INDEX IF NOT EXISTS idx_notes_owner_entity ON notes(owner_email, entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_documents_owner_title ON documents(owner_email, title)",
  "CREATE INDEX IF NOT EXISTS idx_tags_owner_created ON tags(owner_email, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_doc_types_owner_created ON doc_types(owner_email, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_quotation_items_owner_created ON quotation_items(owner_email, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_companies_owner_name ON companies(owner_email, name)",
  "CREATE INDEX IF NOT EXISTS idx_products_owner_name ON products(owner_email, name)",
  "CREATE INDEX IF NOT EXISTS idx_contacts_owner_last_first ON contacts(owner_email, last_name, first_name)",
  "CREATE INDEX IF NOT EXISTS idx_tag_links_owner_entity ON tag_links(owner_email, entity_type, entity_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_owner ON companies(name, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code_owner ON companies(company_code, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_owner ON contacts(email, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_owner ON products(sku, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference_owner ON orders(reference, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_reference_owner ON quotations(reference, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_reference_owner ON invoices(reference, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_owner ON tags(name, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_types_name_owner ON doc_types(name, owner_email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"
];

const schemaIndexStatements = schemaStatements.filter((statement) =>
  statement.startsWith("CREATE INDEX") || statement.startsWith("CREATE UNIQUE INDEX")
);

const schemaCreateStatements = new Map<string, string>();
schemaStatements.forEach((statement) => {
  const match = statement.match(/^CREATE TABLE IF NOT EXISTS (\w+)/);
  if (match) {
    schemaCreateStatements.set(match[1], statement);
  }
});

let schemaInitialized = false;

const app = new Hono<{
  Bindings: Env;
  Variables: { ownerEmail: string; currentUser: UserRow; accessList: string[] };
}>();

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      if (!origin) return "*";
      const allowlist = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
      const requestOrigin = new URL(c.req.url).origin;
      return isOriginAllowed(origin, requestOrigin, allowlist) ? origin : "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-user-email"],
    maxAge: 86400
  })
);

app.use("*", async (c, next) => {
  await next();
  c.res = applySecurityHeaders(c.res);
});

app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env.DB);
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health" || path === "/api/auth/login") {
    await next();
    return;
  }
  const authHeader = c.req.header("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return c.json({ error: "Missing authentication token" }, 401);
  }
  if (!c.env.AUTH_SECRET) {
    return c.json({ error: "Authentication not configured" }, 500);
  }
  const payload = await verifyJwt(token, c.env.AUTH_SECRET);
  if (!payload) {
    return c.json({ error: "Invalid authentication token" }, 401);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return c.json({ error: "Authentication token expired" }, 401);
  }
  const ownerEmail = normalizeEmail(payload.sub);
  const readDb = getReadSession(c.env.DB);
  const user = await getUserByEmail(readDb, ownerEmail);
  if (!user || user.enabled === 0) {
    return c.json({ error: "Account disabled or not found" }, 403);
  }
  const accessList = normalizeAccessList(user.access_list ?? user.access);
  c.set("ownerEmail", ownerEmail);
  c.set("currentUser", user);
  c.set("accessList", accessList);
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString()
  })
);

app.post("/api/auth/login", async (c) => {
  try {
    const ip =
      (c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    if (c.env.CACHE) {
      try {
        const rateLimit = await checkRateLimit(c.env.CACHE, `ratelimit:login:${ip}`);
        if (!rateLimit.allowed) {
          c.header("retry-after", String(rateLimit.retryAfter));
          return c.json({ error: "Too many login attempts. Try again later." }, 429);
        }
      } catch (err) {
        console.warn("Login rate limit check failed", err);
      }
    }
    if (!c.env.AUTH_SECRET) {
      return c.json({ error: "Authentication not configured" }, 500);
    }
    let body: { email?: string; password?: string; name?: string; accessList?: string[]; access?: string } = {};
    try {
      body = await c.req.json<{ email?: string; password?: string; name?: string; accessList?: string[]; access?: string }>();
    } catch {
      // Leave body as empty object
    }
    const email = normalizeEmail(body.email || "");
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return c.json({ error: "Email and password required" }, 400);
    }

  let user = await getUserByEmail(c.env.DB, email);
  if (!user) {
    const total = await countUsers(c.env.DB);
    if (total === 0) {
      const salt = randomSalt();
      const hash = await hashPassword(password, salt);
      const accessList = normalizeAccessList(body.accessList ?? body.access);
      const finalAccessList = accessList.length ? accessList : [...defaultAccessList];
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Admin";
      await c.env.DB.prepare(
        `INSERT INTO users (email, name, role, access, access_list, password_hash, password_salt, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        email,
        name,
        adminRole,
        body.access ?? "",
        JSON.stringify(finalAccessList),
        hash,
        salt
      ).run();
      user = await getUserByEmail(c.env.DB, email);
      if (!user) {
        return c.json({ error: "Unable to create admin account" }, 500);
      }
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { sub: normalizeEmail(user.email || email), iat: issuedAt, exp: issuedAt + AUTH_TOKEN_TTL_SECONDS },
        c.env.AUTH_SECRET
      );
      return c.json({ ok: true, bootstrap: true, user: buildUserResponse(user), token });
    }
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (user.enabled === 0) {
    return c.json({ error: "This account is disabled. Contact an admin." }, 403);
  }
  const salt = user.password_salt || "";
  const hash = user.password_hash || "";
  const valid = salt && hash ? await verifyPassword(password, salt, hash) : false;
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  if (hash && !hash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
    const nextSalt = randomSalt();
    const nextHash = await hashPassword(password, nextSalt);
    await c.env.DB
      .prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(nextHash, nextSalt, user.id)
      .run();
    user.password_hash = nextHash;
    user.password_salt = nextSalt;
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { sub: normalizeEmail(user.email || email), iat: issuedAt, exp: issuedAt + AUTH_TOKEN_TTL_SECONDS },
    c.env.AUTH_SECRET
  );
    return c.json({ ok: true, user: buildUserResponse(user), token });
  } catch (err) {
    console.error("Login failed", err);
    if (c.env.DEBUG_ERRORS === "true") {
      const message = err instanceof Error ? err.message : "Login failed";
      return c.json({ error: "Internal error", detail: message }, 500);
    }
    return c.json({ error: "Internal error" }, 500);
  }
});

app.get("/api/auth/users", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const readDb = getReadSession(c.env.DB);
  const { results } = await readDb
    .prepare(
    "SELECT id, email, name, role, access, access_list, enabled FROM users ORDER BY role = 'Admin' DESC, name, email"
    )
    .bind()
    .all<UserRow>();
  const users = (results ?? []).map((row) => buildUserResponse(row));
  return c.json({ users });
});

app.post("/api/auth/users", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  let body: {
    name?: string;
    email?: string;
    role?: string;
    accessList?: string[];
    access?: string;
    password?: string;
  } = {};
  try {
    body = await c.req.json<{
      name?: string;
      email?: string;
      role?: string;
      accessList?: string[];
      access?: string;
      password?: string;
    }>();
  } catch {
    // Leave body as empty object
  }
  const email = normalizeEmail(body.email || "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return c.json({ error: "Email and password required" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }
  if (await getUserByEmail(c.env.DB, email)) {
    return c.json({ error: "A user with that email already exists" }, 409);
  }

  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const role = body.role || salesRole;
  const accessList = normalizeAccessList(body.accessList ?? body.access);
  const finalAccessList = accessList.length ? accessList : role === adminRole ? [...defaultAccessList] : [];
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : email.split("@")[0];
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, role, access, access_list, password_hash, password_salt, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(
    email,
    name,
    role,
    body.access ?? "",
    JSON.stringify(finalAccessList),
    hash,
    salt
  ).run();

  const user = await getUserByEmail(c.env.DB, email);
  return c.json({ user: user ? buildUserResponse(user) : null });
});

app.put("/api/auth/users/:id", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user id" }, 400);
  }
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    // Leave body as empty object
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string") {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.role === "string") {
    updates.push("role = ?");
    values.push(body.role.trim());
  }
  if (typeof body.access === "string") {
    updates.push("access = ?");
    values.push(body.access.trim());
  }
  if (body.accessList !== undefined) {
    const accessList = normalizeAccessList(body.accessList);
    updates.push("access_list = ?");
    values.push(JSON.stringify(accessList));
  }
  if (body.enabled !== undefined) {
    updates.push("enabled = ?");
    values.push(body.enabled === false ? 0 : 1);
  }
  if (!updates.length) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const current = await c.env.DB.prepare("SELECT id, role, enabled FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!current) {
    return c.json({ error: "User not found" }, 404);
  }

  if (current.role === adminRole) {
    const disabling = body.enabled === false;
    const demoting = typeof body.role === "string" && body.role.trim() !== adminRole;
    if (disabling || demoting) {
      const row = await c.env.DB
        .prepare("SELECT COUNT(*) as count FROM users WHERE role = ? AND enabled = 1")
        .bind(adminRole)
        .first<{ count: number }>();
      if ((row?.count ?? 0) <= 1) {
        return c.json({ error: "At least one admin must remain active" }, 400);
      }
    }
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values, id).run();
  const user = await c.env.DB.prepare("SELECT id, email, name, role, access, access_list, enabled FROM users WHERE id = ?").bind(id).first<UserRow>();
  return c.json({ user: user ? buildUserResponse(user) : null });
});

app.post("/api/auth/users/:id/password", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user id" }, 400);
  }
  let body: { password?: string } = {};
  try {
    body = await c.req.json<{ password?: string }>();
  } catch {
    // Leave body as empty object
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return c.json({ error: "Password required" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  await c.env.DB
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(hash, salt, id)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/auth/users/:id", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user id" }, 400);
  }
  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!target) {
    return c.json({ error: "User not found" }, 404);
  }
  if (target.role === adminRole) {
    const row = await c.env.DB
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = ? AND enabled = 1")
      .bind(adminRole)
      .first<{ count: number }>();
    if ((row?.count ?? 0) <= 1) {
      return c.json({ error: "At least one admin must remain active" }, 400);
    }
  }
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.post("/api/auth/password", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  let body: { currentPassword?: string; newPassword?: string; newEmail?: string } = {};
  try {
    body = await c.req.json<{ currentPassword?: string; newPassword?: string; newEmail?: string }>();
  } catch {
    // Leave body as empty object
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (!currentPassword) {
    return c.json({ error: "Current password required" }, 400);
  }
  const user = await getUserByEmail(c.env.DB, ownerEmail);
  if (!user) {
    return c.json({ error: "Account not found" }, 404);
  }
  const salt = user.password_salt || "";
  const hash = user.password_hash || "";
  const valid = salt && hash ? await verifyPassword(currentPassword, salt, hash) : false;
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let nextEmail = ownerEmail;

  if (body.newPassword) {
    if (body.newPassword.length < 8) {
      return c.json({ error: "New password must be at least 8 characters" }, 400);
    }
    const newSalt = randomSalt();
    const newHash = await hashPassword(body.newPassword, newSalt);
    updates.push("password_hash = ?");
    values.push(newHash);
    updates.push("password_salt = ?");
    values.push(newSalt);
  }

  if (body.newEmail) {
    const normalizedNew = normalizeEmail(body.newEmail);
    if (!normalizedNew.includes("@")) {
      return c.json({ error: "Invalid email" }, 400);
    }
    if (normalizedNew !== ownerEmail) {
      const available = await isEmailAvailable(c.env.DB, normalizedNew);
      if (!available) {
        return c.json({ error: "Email already in use" }, 409);
      }
      await updateOwnerEmailTables(c.env.DB, ownerEmail, normalizedNew);
      await c.env.DB
        .prepare("UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?")
        .bind(normalizedNew, ownerEmail)
        .run();
      await bumpCacheVersions(c.env, normalizedNew, CACHEABLE_TABLES_LIST);
      nextEmail = normalizedNew;
    }
  }

  if (!updates.length) {
    return c.json({ error: "No updates provided" }, 400);
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE email = ?`).bind(...values, ownerEmail).run();
  return c.json({ ok: true, email: nextEmail });
});

app.get("/api/settings/site-config", async (c) => {
  const accessError = requireAccess(c, "settings");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const currentUser = c.get("currentUser") as UserRow | undefined;
  const isAdmin = currentUser?.role === adminRole;
  const cacheBypass = c.req.query("cache") === "0";
  const version = (await c.env.CACHE.get(cacheVersionKey(ownerEmail, "site_config"))) ?? "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/site-config?owner=${encodeURIComponent(ownerEmail)}&v=${version}&admin=${isAdmin ? "1" : "0"}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: SITE_CONFIG_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const config = await getSiteConfig(readDb, ownerEmail);
      if (config && !isAdmin) {
        const { aiProvider, aiApiUrl, aiModel, aiKeySet, ...safeConfig } = config as Record<string, unknown>;
        return { config: safeConfig };
      }
      return { config: config ?? {} };
    }
  });
});

app.put("/api/settings/site-config", async (c) => {
  const accessError = requireAccess(c, "settings");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const payload = await c.req.json<SiteConfigPayload>().catch(() => ({}));
  const currentUser = c.get("currentUser") as UserRow | undefined;
  const isAdmin = currentUser?.role === adminRole;
  if (!isAdmin) {
    delete (payload as Partial<SiteConfigPayload>).aiProvider;
    delete (payload as Partial<SiteConfigPayload>).aiApiUrl;
    delete (payload as Partial<SiteConfigPayload>).aiApiKey;
    delete (payload as Partial<SiteConfigPayload>).aiModel;
  }
  const config = await upsertSiteConfig(c.env.DB, ownerEmail, payload);
  await bumpCacheVersion(c.env, ownerEmail, "site_config");
  if (!isAdmin && config) {
    const { aiProvider, aiApiUrl, aiModel, aiKeySet, ...safeConfig } = config as Record<string, unknown>;
    return c.json({ ok: true, config: safeConfig });
  }
  return c.json({ ok: true, config });
});

app.get("/api/dashboard", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(`https://cache.local/api/dashboard?owner=${encodeURIComponent(ownerEmail)}`);
  return cacheJson({
    cacheKey,
    ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      await syncShippingMilestones(c.env.DB, ownerEmail);
      const readDb = getReadSession(c.env.DB, true);
      const stats = await getStats(readDb, ownerEmail);
      const pipeline = await getPipeline(readDb, ownerEmail);
      const activity = await getActivity(readDb, ownerEmail);
      return { stats, pipeline, activity };
    }
  });
});

app.get("/api/backup/manifest", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const ownerEmail = c.get("ownerEmail");
  const readDb = getReadSession(c.env.DB);
  const tables = [];
  for (const table of backupTables) {
    const hasOwner = ownerEmailTables.includes(table);
    const sql = hasOwner
      ? `SELECT COUNT(*) as count FROM ${table} WHERE owner_email = ?`
      : `SELECT COUNT(*) as count FROM ${table}`;
    const stmt = readDb.prepare(sql);
    const row = hasOwner ? await stmt.bind(ownerEmail).first<{ count?: number }>() : await stmt.first<{ count?: number }>();
    tables.push({ name: table, count: row?.count ?? 0 });
  }

  const fileRows = await readDb
    .prepare(
      `SELECT storage_key as key, content_type, size, created_at, updated_at, 'documents' as source
       FROM documents
       WHERE owner_email = ? AND storage_key IS NOT NULL AND storage_key <> ''
       UNION
       SELECT attachment_key as key, NULL as content_type, NULL as size, created_at, updated_at, 'quotations' as source
       FROM quotations
       WHERE owner_email = ? AND attachment_key IS NOT NULL AND attachment_key <> ''
       UNION
       SELECT attachment_key as key, NULL as content_type, NULL as size, created_at, updated_at, 'invoices' as source
       FROM invoices
       WHERE owner_email = ? AND attachment_key IS NOT NULL AND attachment_key <> ''`
    )
    .bind(ownerEmail, ownerEmail, ownerEmail)
    .all<{ key?: string; content_type?: string | null; size?: number | null; created_at?: string | null; updated_at?: string | null; source?: string | null }>();

  const fileMap = new Map<string, {
    key: string;
    sources: string[];
    content_type: string | null;
    size: number | null;
    created_at: string | null;
    updated_at: string | null;
  }>();
  (fileRows.results ?? []).forEach((row) => {
    const key = (row.key || "").trim();
    if (!key) return;
    if (!fileMap.has(key)) {
      fileMap.set(key, {
        key,
        sources: [],
        content_type: row.content_type ?? null,
        size: typeof row.size === "number" ? row.size : null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null
      });
    }
    const entry = fileMap.get(key);
    const source = row.source ? row.source.toString() : "";
    if (entry && source && !entry.sources.includes(source)) {
      entry.sources.push(source);
    }
  });

  return c.json({
    generated_at: new Date().toISOString(),
    owner_email: ownerEmail,
    tables,
    files: Array.from(fileMap.values())
  });
});

app.get("/api/backup/table/:table", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const table = c.req.param("table");
  if (!backupTables.includes(table)) {
    return c.json({ error: "Unknown table" }, 404);
  }
  const ownerEmail = c.get("ownerEmail");
  const limitRaw = Number.parseInt(c.req.query("limit") || "500", 10);
  const offsetRaw = Number.parseInt(c.req.query("offset") || "0", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 500;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  const columns = tableColumns[table] ?? ["*"];
  const orderColumn = getBackupOrderColumn(table);
  let sql = `SELECT ${columns.join(", ")} FROM ${table}`;
  const params: Array<string | number> = [];
  if (ownerEmailTables.includes(table)) {
    sql += " WHERE owner_email = ?";
    params.push(ownerEmail);
  }
  sql += ` ORDER BY ${orderColumn} ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const readDb = getReadSession(c.env.DB);
  const result = await readDb.prepare(sql).bind(...params).all();
  return c.json({ table, rows: result.results ?? [], limit, offset });
});

app.post("/api/backup/restore/table/:table", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const table = c.req.param("table");
  if (!backupTables.includes(table)) {
    return c.json({ error: "Unknown table" }, 404);
  }
  const payload = await c.req.json<{ rows?: Array<Record<string, unknown>>; clear?: boolean }>().catch(() => ({}));
  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (!rows) {
    return c.json({ error: "Rows array required" }, 400);
  }
  const ownerEmail = c.get("ownerEmail");
  const clear = payload.clear === true || c.req.query("clear") === "1";
  const columns = tableColumns[table] ?? [];
  if (!columns.length) {
    return c.json({ error: "No columns configured" }, 400);
  }
  const isOwnerScoped = ownerEmailTables.includes(table);

  if (clear) {
    const clearSql = isOwnerScoped ? `DELETE FROM ${table} WHERE owner_email = ?` : `DELETE FROM ${table}`;
    const clearStmt = c.env.DB.prepare(clearSql);
    if (isOwnerScoped) {
      await clearStmt.bind(ownerEmail).run();
    } else {
      await clearStmt.run();
    }
  }

  if (rows.length) {
    const placeholders = columns.map(() => "?").join(", ");
    const insertSql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
    const baseStmt = c.env.DB.prepare(insertSql);
    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      const values = columns.map((column) => {
        if (isOwnerScoped && column === "owner_email") {
          return ownerEmail;
        }
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          return (row as Record<string, unknown>)[column] ?? null;
        }
        return null;
      });
      statements.push(baseStmt.bind(...values));
    }
    await batchInChunks(c.env.DB, statements);
  }

  await bumpCacheVersion(c.env, ownerEmail, table);
  return c.json({ ok: true, table, rows: rows.length, cleared: clear });
});

app.put("/api/backup/files/:key{.+}", async (c) => {
  const adminError = requireAdminUser(c);
  if (adminError) return adminError;
  const keyParam = c.req.param("key");
  const key = decodeURIComponent(keyParam || "");
  if (!key || key.includes("..") || key.startsWith("/")) {
    return c.text("Missing file key", 400);
  }

  let body: ArrayBuffer | null = null;
  try {
    body = await c.req.arrayBuffer();
  } catch (err) {
    console.error("Failed to read upload body", err);
    return c.text("Invalid file body", 400);
  }

  if (!body || !body.byteLength) {
    return c.text("Missing file body", 400);
  }

  const contentType = normalizeContentType(c.req.header("content-type"));
  if (!allowedUploadContentTypes.has(contentType)) {
    return c.text("Unsupported file type", 415);
  }
  await c.env.FILES.put(key, body, { httpMetadata: { contentType } });

  return c.json({ key });
});

app.get("/api/search", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const query = (c.req.query("q") || "").trim();
  const limitRaw = Number(c.req.query("limit") || "5");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 5;
  if (query.length < 2) {
    return c.json({ query, results: [] });
  }
  const user = c.get("currentUser") as UserRow | undefined;
  const accessList = (c.get("accessList") as string[] | undefined) ?? [];
  if (!user) {
    return c.json({ error: "Access denied" }, 403);
  }

  const readDb = getReadSession(c.env.DB);
  const results: Array<{ table: string; record: Record<string, unknown> }> = [];
  const likeValue = `%${query}%`;
  for (const [table, fields] of Object.entries(searchableFields)) {
    const accessId = accessByTable[table];
    if (!accessId || !hasAccess(user, accessList, accessId)) continue;
    const columns = tableColumns[table];
    if (!columns?.length) continue;
    const orderColumn = getSearchOrderColumn(table);
    const whereParts = fields.map((field) => `${field} LIKE ? COLLATE NOCASE`);
    const sql = `SELECT ${columns.join(", ")} FROM ${table} WHERE owner_email = ? AND (${whereParts.join(
      " OR "
    )}) ORDER BY ${orderColumn} DESC LIMIT ?`;
    const params = [ownerEmail, ...fields.map(() => likeValue), limit];
    const response = await readDb.prepare(sql).bind(...params).all<Record<string, unknown>>();
    (response.results ?? []).forEach((row) => {
      results.push({ table, record: row });
    });
  }

  return c.json({ query, results });
});

app.get("/api/kpis", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const ownerError = validateOwnerParam(ownerEmail, searchParams);
  if (ownerError) return c.json({ error: ownerError }, 403);
  const range = parseDateRange(searchParams, 120);
  const filters = parseAnalyticsFilters(searchParams);
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/kpis?owner=${encodeURIComponent(ownerEmail)}&${searchParams.toString()}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const kpis = await getKpis(readDb, ownerEmail, range, filters);
      return { range, ...kpis };
    }
  });
});

app.get("/api/timeseries", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const ownerError = validateOwnerParam(ownerEmail, searchParams);
  if (ownerError) return c.json({ error: ownerError }, 403);
  const metric = (c.req.query("metric") || "revenue").toLowerCase();
  const grain = (c.req.query("grain") || "week").toLowerCase();
  if (!["revenue", "orders", "invoices", "quotations", "samples", "tasks", "shipping"].includes(metric)) {
    return c.json({ error: "Invalid metric" }, 400);
  }
  if (!["day", "week", "month"].includes(grain)) {
    return c.json({ error: "Invalid grain" }, 400);
  }
  const range = parseDateRange(searchParams, 120);
  const filters = parseAnalyticsFilters(searchParams);
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/timeseries?owner=${encodeURIComponent(ownerEmail)}&${searchParams.toString()}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const series = await getTimeSeries(
        readDb,
        ownerEmail,
        metric as "revenue" | "orders" | "invoices" | "quotations" | "samples" | "tasks" | "shipping",
        grain as "day" | "week" | "month",
        range,
        filters
      );
      return { range, metric, grain, data: series };
    }
  });
});

app.get("/api/breakdown", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const ownerError = validateOwnerParam(ownerEmail, searchParams);
  if (ownerError) return c.json({ error: ownerError }, 403);
  const entity = (c.req.query("entity") || "status").toLowerCase();
  const metric = (c.req.query("metric") || "count").toLowerCase();
  if (!["company", "product_category", "status", "assignee"].includes(entity)) {
    return c.json({ error: "Invalid entity" }, 400);
  }
  if (!["revenue", "count"].includes(metric)) {
    return c.json({ error: "Invalid metric" }, 400);
  }
  const range = parseDateRange(searchParams, 120);
  const filters = parseAnalyticsFilters(searchParams);
  const source = (c.req.query("source") || "").trim();
  const field = (c.req.query("field") || "").trim();
  const requiresQuotation = c.req.query("requires_quotation") === "1";
  const limitRaw = Number(c.req.query("limit") || "10");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/breakdown?owner=${encodeURIComponent(ownerEmail)}&${searchParams.toString()}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const data = await getBreakdown(
        readDb,
        ownerEmail,
        entity as "company" | "product_category" | "status" | "assignee",
        metric as "revenue" | "count",
        range,
        filters,
        {
          source: source || undefined,
          field: field || undefined,
          limit,
          requireQuotation: requiresQuotation
        }
      );
      return {
        range,
        entity,
        metric,
        source: source || null,
        field: field || null,
        requires_quotation: requiresQuotation || null,
        data
      };
    }
  });
});

app.get("/api/forecast", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const ownerError = validateOwnerParam(ownerEmail, searchParams);
  if (ownerError) return c.json({ error: ownerError }, 403);
  const metric = (c.req.query("metric") || "revenue").toLowerCase();
  const grain = (c.req.query("grain") || "month").toLowerCase();
  if (
    ![
      "revenue",
      "orders",
      "invoices",
      "quotations",
      "tasks",
      "shipping",
      "open_invoices",
      "overdue_invoices"
    ].includes(metric)
  ) {
    return c.json({ error: "Invalid metric" }, 400);
  }
  if (!["week", "month"].includes(grain)) {
    return c.json({ error: "Invalid grain" }, 400);
  }
  const horizonRaw = Number(c.req.query("horizon") || "12");
  const horizon = Number.isFinite(horizonRaw) ? Math.min(Math.max(horizonRaw, 1), 36) : 12;
  const fallbackDays = grain === "month" ? 540 : 365;
  const range = parseDateRange(searchParams, fallbackDays);
  const filters = parseAnalyticsFilters(searchParams);
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/forecast?owner=${encodeURIComponent(ownerEmail)}&${searchParams.toString()}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const baseSeries = await getForecastSeries(
        readDb,
        ownerEmail,
        metric as ForecastMetric,
        grain as "week" | "month",
        range,
        filters
      );
      const series = fillSeries(baseSeries, range, grain as "week" | "month");
      const countMetrics = new Set([
        "orders",
        "invoices",
        "quotations",
        "tasks",
        "shipping",
        "open_invoices",
        "overdue_invoices"
      ]);
      const forecast = buildForecast(series, grain as "week" | "month", horizon, countMetrics.has(metric));
      return {
        range,
        metric,
        grain,
        horizon,
        series,
        forecast: forecast.forecast,
        confidence: forecast.confidence,
        backtest: forecast.backtest
      };
    }
  });
});

app.get("/api/data-quality", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const ownerError = validateOwnerParam(ownerEmail, searchParams);
  if (ownerError) return c.json({ error: ownerError }, 403);
  const cacheBypass = c.req.query("cache") === "0";
  const cacheKey = buildCacheRequest(
    `https://cache.local/api/data-quality?owner=${encodeURIComponent(ownerEmail)}&${searchParams.toString()}`
  );
  return cacheJson({
    cacheKey,
    ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
    request: c.req.raw,
    bypass: cacheBypass,
    data: async () => {
      const readDb = getReadSession(c.env.DB);
      const data = await getDataQuality(readDb, ownerEmail);
      return { data };
    }
  });
});

app.post("/api/ai/research", async (c) => {
  const accessError = requireAccess(c, "analytics");
  if (accessError) return accessError;

  let body: {
    question?: string;
    tables?: string[];
    limit?: number;
    includeContext?: boolean;
    includeDataQuality?: boolean;
    dataQuality?: boolean;
    data_quality?: boolean;
    debug?: boolean;
  } = {};
  try {
    body = await c.req.json<typeof body>();
  } catch {
    // Leave body as empty object
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return c.json({ error: "Question required" }, 400);
  }
  if (question.length > AI_MAX_QUESTION_LENGTH) {
    return c.json({ error: `Question too long (max ${AI_MAX_QUESTION_LENGTH} chars)` }, 400);
  }

  const ownerEmail = c.get("ownerEmail");
  const user = c.get("currentUser") as UserRow | undefined;
  const accessList = (c.get("accessList") as string[] | undefined) ?? [];
  if (!user) {
    return c.json({ error: "Access denied" }, 403);
  }

  const tables = normalizeAiTables(body.tables, user, accessList);
  if (!tables.length) {
    return c.json({ error: "No accessible tables available for research" }, 403);
  }

  const limit = normalizeAiLimit(body.limit);
  const readDb = getReadSession(c.env.DB);
  const aiConfig = await getAiConfig(readDb, ownerEmail);
  const model = resolveAiModel(aiConfig, c.env);
  if (aiConfig.provider === "custom") {
    if (!aiConfig.apiUrl) {
      return c.json({ error: "Custom AI API URL not configured" }, 501);
    }
    if (!model) {
      return c.json({ error: "Custom AI model not configured" }, 501);
    }
  } else if (!c.env.AI) {
    return c.json({ error: "AI binding not configured" }, 501);
  }

  const stats = await getStats(readDb, ownerEmail);
  const pipeline = await getPipeline(readDb, ownerEmail);
  const activity = await getActivity(readDb, ownerEmail);
  const includeDataQuality =
    body.includeDataQuality === true || body.dataQuality === true || body.data_quality === true;

  const tableData: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await fetchRows(readDb, table, ownerEmail, [], limit, 0);
    tableData[table] = rows.map((row) => sanitizeAiRecord(row as Record<string, unknown>));
  }

  const context: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    stats,
    pipeline,
    activity,
    tables: tableData
  };

  if (includeDataQuality) {
    context.data_quality = await getDataQuality(readDb, ownerEmail);
  }

  const messages = [
    {
      role: "system",
      content:
        "You are a CRM data analyst. Use only the provided context. If data is insufficient, say so. " +
        "Return concise insights, risks/opportunities, and follow-up questions."
    },
    {
      role: "user",
      content: `Question: ${question}\n\nContext:\n${JSON.stringify(context)}`
    }
  ];

  try {
    let responseText = "";
    let modelUsed = model;
    if (aiConfig.provider === "custom") {
      const result = await runCustomAiRequest(aiConfig, model, messages, { maxTokens: 600, temperature: 0.2 });
      responseText = result.text;
      modelUsed = result.model;
    } else {
      const aiResult = await c.env.AI.run(model, {
        messages,
        max_tokens: 600,
        temperature: 0.2
      });
      responseText =
        typeof aiResult === "string"
          ? aiResult
          : (aiResult as { response?: string; output_text?: string }).response ??
            (aiResult as { response?: string; output_text?: string }).output_text ??
            JSON.stringify(aiResult);
    }
    const includeContext = body.includeContext === true || body.debug === true;
    return c.json({
      model: modelUsed,
      question,
      response: responseText,
      tables,
      context: includeContext ? context : undefined
    });
  } catch (err) {
    console.error("AI research failed", err);
    const message = err instanceof Error ? err.message : "AI research failed";
    if (shouldIncludeErrorDetail(c)) {
      return c.json({ error: "AI research failed", detail: message }, 500);
    }
    return c.json({ error: "AI research failed" }, 500);
  }
});

app.post("/api/ai/propose", async (c) => {
  const accessError = requireAccess(c, "analytics");
  if (accessError) return accessError;

  let body: {
    instruction?: string;
    question?: string;
    tables?: string[];
    limit?: number;
    includeDataQuality?: boolean;
    dataQuality?: boolean;
    data_quality?: boolean;
  } = {};
  try {
    body = await c.req.json<typeof body>();
  } catch {
    // Leave body as empty object
  }

  const question = typeof body.instruction === "string" && body.instruction.trim()
    ? body.instruction.trim()
    : typeof body.question === "string"
      ? body.question.trim()
      : "";
  if (!question) {
    return c.json({ error: "Instruction required" }, 400);
  }
  if (question.length > AI_MAX_QUESTION_LENGTH) {
    return c.json({ error: `Instruction too long (max ${AI_MAX_QUESTION_LENGTH} chars)` }, 400);
  }

  const ownerEmail = c.get("ownerEmail");
  const user = c.get("currentUser") as UserRow | undefined;
  const accessList = (c.get("accessList") as string[] | undefined) ?? [];
  if (!user) {
    return c.json({ error: "Access denied" }, 403);
  }

  const tables = normalizeAiTables(body.tables, user, accessList);
  if (!tables.length) {
    return c.json({ error: "No accessible tables available for updates" }, 403);
  }

  const limit = normalizeAiLimit(body.limit);
  const readDb = getReadSession(c.env.DB);
  const aiConfig = await getAiConfig(readDb, ownerEmail);
  const model = resolveAiModel(aiConfig, c.env);
  if (aiConfig.provider === "custom") {
    if (!aiConfig.apiUrl) {
      return c.json({ error: "Custom AI API URL not configured" }, 501);
    }
    if (!model) {
      return c.json({ error: "Custom AI model not configured" }, 501);
    }
  } else if (!c.env.AI) {
    return c.json({ error: "AI binding not configured" }, 501);
  }
  const stats = await getStats(readDb, ownerEmail);
  const pipeline = await getPipeline(readDb, ownerEmail);
  const activity = await getActivity(readDb, ownerEmail);
  const includeDataQuality =
    body.includeDataQuality === true || body.dataQuality === true || body.data_quality === true;

  const tableData: Record<string, unknown[]> = {};
  const tableIds: Record<string, number[]> = {};
  for (const table of tables) {
    const rows = await fetchRows(readDb, table, ownerEmail, [], limit, 0);
    const sanitized = rows.map((row) => sanitizeAiRecord(row as Record<string, unknown>));
    tableData[table] = sanitized;
    tableIds[table] = sanitized
      .map((row) => Number((row as { id?: number }).id))
      .filter((id) => Number.isFinite(id));
  }

  const allowedUpdateFields = Object.fromEntries(
    Object.entries(updatableFields).map(([table, fields]) => [table, [...fields]])
  );

  const context: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    stats,
    pipeline,
    activity,
    tables: tableData,
    table_ids: tableIds,
    allowed_update_fields: allowedUpdateFields
  };

  if (includeDataQuality) {
    context.data_quality = await getDataQuality(readDb, ownerEmail);
  }

  const messages = [
    {
      role: "system",
      content:
        "You are a CRM operations assistant. Use ONLY the provided context. " +
        "Return STRICT JSON with keys: summary (string), actions (array), warnings (array). " +
        "Only propose update actions. Each action must be: { action:'update', table, id, changes, reason, confidence }. " +
        "Use only allowed_update_fields and only IDs present in table_ids. " +
        "If insufficient info, return actions: [] and add a warning."
    },
    {
      role: "user",
      content: `Instruction: ${question}\n\nContext:\n${JSON.stringify(context)}`
    }
  ];

  try {
    let responseText = "";
    let modelUsed = model;
    if (aiConfig.provider === "custom") {
      const result = await runCustomAiRequest(aiConfig, model, messages, { maxTokens: 700, temperature: 0.1 });
      responseText = result.text;
      modelUsed = result.model;
    } else {
      const aiResult = await c.env.AI.run(model, {
        messages,
        max_tokens: 700,
        temperature: 0.1
      });
      responseText =
        typeof aiResult === "string"
          ? aiResult
          : (aiResult as { response?: string; output_text?: string }).response ??
            (aiResult as { response?: string; output_text?: string }).output_text ??
            JSON.stringify(aiResult);
    }
    const plan = parseAiJson(responseText);
    if (!plan || typeof plan !== "object") {
      return c.json({ error: "AI response invalid", response: responseText }, 502);
    }

    const rawActions = Array.isArray((plan as { actions?: unknown[] }).actions)
      ? (plan as { actions?: unknown[] }).actions!
      : [];
    const warnings = Array.isArray((plan as { warnings?: unknown[] }).warnings)
      ? (plan as { warnings?: unknown[] }).warnings!.map((item) => String(item))
      : [];
    const summary = typeof (plan as { summary?: unknown }).summary === "string"
      ? String((plan as { summary?: unknown }).summary)
      : "";

    const allowedTablesSet = new Set(tables);
    const idLookup: Record<string, Set<number>> = {};
    Object.entries(tableIds).forEach(([table, ids]) => {
      idLookup[table] = new Set(ids);
    });

    const sanitizedActions = rawActions
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const action = String((entry as { action?: unknown }).action || "").toLowerCase();
        if (action !== "update") return null;
        const table = String((entry as { table?: unknown }).table || "").trim();
        if (!allowedTablesSet.has(table)) return null;
        const idRaw = (entry as { id?: unknown }).id;
        const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
        if (!Number.isFinite(id)) return null;
        if (!idLookup[table] || !idLookup[table].has(id)) return null;
        const changesRaw = (entry as { changes?: unknown }).changes;
        if (!changesRaw || typeof changesRaw !== "object") return null;
        const allowedFields = new Set(allowedUpdateFields[table] ?? []);
        const changes: Record<string, unknown> = {};
        Object.entries(changesRaw as Record<string, unknown>).forEach(([key, value]) => {
          if (allowedFields.has(key)) {
            changes[key] = value;
          }
        });
        if (!Object.keys(changes).length) return null;
        const confidenceRaw = Number((entry as { confidence?: unknown }).confidence);
        return {
          action: "update",
          table,
          id,
          changes,
          reason: typeof (entry as { reason?: unknown }).reason === "string" ? (entry as { reason?: string }).reason : "",
          confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : undefined
        };
      })
      .filter(Boolean);

    return c.json({
      model: modelUsed,
      instruction: question,
      summary,
      actions: sanitizedActions,
      warnings,
      tables
    });
  } catch (err) {
    console.error("AI propose failed", err);
    const message = err instanceof Error ? err.message : "AI propose failed";
    if (shouldIncludeErrorDetail(c)) {
      return c.json({ error: "AI propose failed", detail: message }, 500);
    }
    return c.json({ error: "AI propose failed" }, 500);
  }
});

app.get("/api/tracking/shippo", async (c) => {
  const accessError = requireAccess(c, "shipping");
  if (accessError) return accessError;
  const apiKey = c.env.SHIPPO_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Shippo API key not configured" }, 501);
  }
  const waybill = (c.req.query("waybill") || "").trim();
  if (!waybill) {
    return c.json({ error: "Missing waybill number" }, 400);
  }
  const courier = (c.req.query("courier") || "").trim();
  const carrier = resolveShippoCarrier(courier);
  if (!carrier) {
    return c.json({ error: "Carrier required for tracking" }, 400);
  }

  const res = await fetch("https://api.goshippo.com/tracks/", {
    method: "POST",
    headers: {
      authorization: `ShippoToken ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      carrier,
      tracking_number: waybill
    })
  });

  if (!res.ok) {
    const details = await res.text();
    console.error("Shippo tracking failed", res.status, details);
    return c.json({ error: "Tracking lookup failed" }, 502);
  }

  const data = await res.json<any>();
  const trackingStatus = data?.tracking_status ?? {};
  const trackingHistory = Array.isArray(data?.tracking_history) ? data.tracking_history : [];
  const trackingDetails = trackingHistory.map((detail: any) => ({
    status: detail?.status ?? null,
    message: detail?.status_details ?? null,
    datetime: detail?.status_date ?? null,
    tracking_location: detail?.location ?? null
  }));

  return c.json({
    carrier: data?.carrier ?? carrier,
    tracking_code: data?.tracking_number ?? waybill,
    status: trackingStatus?.status ?? null,
    status_detail: trackingStatus?.status_details ?? null,
    updated_at: trackingStatus?.status_date ?? null,
    est_delivery_date: data?.eta ?? null,
    tracking_details: trackingDetails
  });
});

app.get("/api/:table", async (c) => {
  const table = c.req.param("table");
  if (!allowedTables.includes(table)) {
    return c.json({ error: "Unknown table" }, 404);
  }
  const accessError = requireAccess(c, accessByTable[table]);
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const searchParams = new URL(c.req.url).searchParams;
  const filters = parseFilters(table, searchParams);
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const cacheBypass = c.req.query("cache") === "0";
  const limitRaw = limitParam ? Number.parseInt(limitParam, 10) : 50;
  const offsetRaw = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  const needsPrimary = table === "orders" || table === "invoices" || table === "shipping_schedules";
  const cacheEnabled = !cacheBypass && cacheableTables.has(table);

  if (cacheEnabled) {
    const filterKey = buildFilterKey(filters);
    const version = (await c.env.CACHE.get(cacheVersionKey(ownerEmail, table))) ?? "0";
    const cacheKey = buildCacheRequest(buildCacheKey(ownerEmail, table, filterKey, version, limit, offset));
    return cacheJson({
      cacheKey,
      ttlSeconds: CACHE_TTL_SECONDS,
      request: c.req.raw,
      data: async () => {
        if (needsPrimary) {
          await syncShippingMilestones(c.env.DB, ownerEmail);
        }
        const readDb = getReadSession(c.env.DB, needsPrimary);
        const rows = await fetchRows(readDb, table, ownerEmail, filters, limit, offset);
        return { rows };
      }
    });
  }

  if (needsPrimary) {
    await syncShippingMilestones(c.env.DB, ownerEmail);
  }
  const readDb = getReadSession(c.env.DB, needsPrimary);
  const rows = await fetchRows(readDb, table, ownerEmail, filters, limit, offset);
  return c.json({ rows });
});

app.post("/api/account/update", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{ email?: string }>();
  const nextEmail = (body.email || "").trim().toLowerCase();
  if (!nextEmail) {
    return c.json({ error: "Email required" }, 400);
  }
  if (nextEmail === ownerEmail) {
    return c.json({ ok: true, email: ownerEmail });
  }
  if (!nextEmail.includes("@")) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const available = await isEmailAvailable(c.env.DB, nextEmail);
  if (!available) {
    return c.json({ error: "Email already in use" }, 409);
  }

  await updateOwnerEmailTables(c.env.DB, ownerEmail, nextEmail);
  await c.env.DB
    .prepare("UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?")
    .bind(nextEmail, ownerEmail)
    .run();
  await bumpCacheVersions(c.env, nextEmail, CACHEABLE_TABLES_LIST);

  return c.json({ ok: true, email: nextEmail });
});

app.put("/api/:table/:id", async (c) => {
  const table = c.req.param("table");
  const id = Number(c.req.param("id"));
  if (!updatableFields[table] || Number.isNaN(id)) {
    return c.json({ error: "Invalid table or id" }, 400);
  }
  const accessError = requireAccess(c, accessByTable[table]);
  if (accessError) return accessError;

  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<Record<string, unknown>>();
  if (table === "orders") {
    const invoiceIds = normalizeInvoiceIds((body as any).invoice_ids ?? (body as any).invoice_links);
    if (invoiceIds !== null) {
      (body as any).invoice_ids = invoiceIds;
    }
  }
  if (table === "sample_shipments" && "quantity" in body) {
    const quantity = normalizeNonNegativeNumber((body as any).quantity);
    if (quantity === null) {
      return c.json({ error: "Quantity must be 0 or greater" }, 400);
    }
    (body as any).quantity = quantity;
  }
  if (table === "products") {
    const rawName = body.name;
    if (typeof rawName === "string") {
      const trimmed = rawName.trim();
      if (!trimmed) {
        return c.json({ error: "Name required" }, 400);
      }
      body.name = trimmed;
    } else if (rawName !== undefined) {
      return c.json({ error: "Name required" }, 400);
    }

    if ("sku" in body) {
      body.sku = normalizeOptionalText(body.sku as string | null | undefined);
    }
    if ("category" in body) {
      body.category = normalizeOptionalText(body.category as string | null | undefined);
    }
    if ("description" in body) {
      body.description = normalizeOptionalText(body.description as string | null | undefined);
    }
    if ("currency" in body) {
      body.currency = normalizeOptionalText(body.currency as string | null | undefined) ?? "USD";
    }
    if ("status" in body) {
      body.status = normalizeOptionalText(body.status as string | null | undefined) ?? "Active";
    }
    if ("price" in body) {
      const parsed = typeof body.price === "number" ? body.price : Number(body.price);
      body.price = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  let quotationItems: Array<Record<string, unknown>> | null = null;
  if (table === "quotations" && Array.isArray((body as any).items)) {
    quotationItems = (body as any).items as Array<Record<string, unknown>>;
    delete (body as any).items;
  }
  const tags = normalizeTags((body as any).tags);
  const entries = Object.entries(body).filter(([key]) => updatableFields[table].includes(key));

  if (!entries.length && !tags.length && !quotationItems) {
    return c.json({ error: "No fields to update" }, 400);
  }

  let changes = 0;
  if (entries.length) {
    const setParts = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => (value === undefined ? null : value));
    const stmt = c.env.DB
      .prepare(`UPDATE ${table} SET ${setParts} WHERE id = ? AND owner_email = ?`)
      .bind(...values, id, ownerEmail);
    const result = await stmt.run();
    changes = result.meta.changes;
  }

  const entityType = entityTypes[table];
  if (entityType && tags.length) {
    await c.env.DB
      .prepare("DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ? AND owner_email = ?")
      .bind(entityType, id, ownerEmail)
      .run();
    await attachTags(c.env.DB, ownerEmail, entityType, id, tags);
  }

  let lineItemsChanged = false;
  if (table === "quotations" && quotationItems) {
    const normalizeLineItem = (item: Record<string, unknown>) => {
      const productIdRaw = item.product_id as unknown;
      const productId =
        typeof productIdRaw === "number"
          ? productIdRaw
          : typeof productIdRaw === "string"
            ? Number(productIdRaw)
            : NaN;
      const product_id = Number.isFinite(productId) ? productId : null;
      const product_name = normalizeOptionalText(item.product_name as string | null | undefined);
      const qty = normalizeNonNegativeNumber(item.qty);
      const unit_price = normalizeNonNegativeNumber(item.unit_price);
      const drums_price = normalizeNonNegativeNumber(item.drums_price);
      const bank_charge_price = normalizeNonNegativeNumber(item.bank_charge_price);
      const shipping_price = normalizeNonNegativeNumber(item.shipping_price);
      const customer_commission = normalizeNonNegativeNumber(item.customer_commission);
      const lineTotalRaw = normalizeNonNegativeNumber(item.line_total);
      const computedTotal =
        (qty ?? 0) *
        ((unit_price ?? 0) + (drums_price ?? 0) + (bank_charge_price ?? 0) + (shipping_price ?? 0) + (customer_commission ?? 0));
      const line_total =
        lineTotalRaw !== null && lineTotalRaw !== undefined && (lineTotalRaw !== 0 || computedTotal === 0)
          ? lineTotalRaw
          : computedTotal;
      return {
        product_id,
        product_name,
        qty: qty ?? 0,
        unit_price: unit_price ?? 0,
        drums_price: drums_price ?? 0,
        bank_charge_price: bank_charge_price ?? 0,
        shipping_price: shipping_price ?? 0,
        customer_commission: customer_commission ?? 0,
        line_total
      };
    };

    await c.env.DB
      .prepare("DELETE FROM quotation_items WHERE quotation_id = ? AND owner_email = ?")
      .bind(id, ownerEmail)
      .run();

    if (quotationItems.length) {
      const inserts = quotationItems.map((item) => {
        const normalized = normalizeLineItem(item || {});
        return c.env.DB.prepare(
          `INSERT INTO quotation_items (quotation_id, product_id, product_name, qty, unit_price, drums_price, bank_charge_price, shipping_price, customer_commission, line_total, owner_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          normalized.product_id,
          normalized.product_name,
          normalized.qty,
          normalized.unit_price,
          normalized.drums_price,
          normalized.bank_charge_price,
          normalized.shipping_price,
          normalized.customer_commission,
          normalized.line_total,
          ownerEmail
        );
      });
      await batchInChunks(c.env.DB, inserts);
    }
    lineItemsChanged = true;
  }

  if (table === "shipping_schedules") {
    await syncShippingMilestones(c.env.DB, ownerEmail);
  }

  if (changes || tags.length || lineItemsChanged) {
    await bumpCacheVersion(c.env, ownerEmail, table);
    if (lineItemsChanged) {
      await bumpCacheVersion(c.env, ownerEmail, "quotation_items");
    }
  }
  return c.json({ ok: true, changes });
});

app.delete("/api/:table/:id", async (c) => {
  const table = c.req.param("table");
  const id = Number(c.req.param("id"));
  if (!updatableFields[table] || Number.isNaN(id)) {
    return c.json({ error: "Invalid table or id" }, 400);
  }
  const accessError = requireAccess(c, accessByTable[table]);
  if (accessError) return accessError;

  const ownerEmail = c.get("ownerEmail");
  const entityType = entityTypes[table];
  if (entityType) {
    await c.env.DB
      .prepare("DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ? AND owner_email = ?")
      .bind(entityType, id, ownerEmail)
      .run();
  }

  // Manual cascades to avoid FK errors
  if (table === "orders") {
    await c.env.DB.prepare("DELETE FROM shipping_schedules WHERE order_id = ? AND owner_email = ?").bind(id, ownerEmail).run();
  }
  if (table === "companies") {
    const targets = [
      "contacts",
      "orders",
      "quotations",
      "invoices",
      "documents",
      "shipping_schedules",
      "sample_shipments"
    ];
    const detach = [];
    for (const target of targets) {
      if (await hasColumn(c.env.DB, target, "company_id")) {
        detach.push(
          c.env.DB
            .prepare(`UPDATE ${target} SET company_id = NULL WHERE company_id = ? AND owner_email = ?`)
            .bind(id, ownerEmail)
        );
      }
    }
    if (detach.length) {
      await batchInChunks(c.env.DB, detach);
    }
  }
  if (table === "products") {
    const targets = ["quotation_items", "sample_shipments"];
    const detach = [];
    for (const target of targets) {
      if (await hasColumn(c.env.DB, target, "product_id")) {
        detach.push(
          c.env.DB
            .prepare(`UPDATE ${target} SET product_id = NULL WHERE product_id = ? AND owner_email = ?`)
            .bind(id, ownerEmail)
        );
      }
    }
    if (detach.length) {
      await batchInChunks(c.env.DB, detach);
    }
  }

  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND owner_email = ?`).bind(id, ownerEmail).run();
  await bumpCacheVersion(c.env, ownerEmail, table);
  return c.json({ ok: true });
});

app.post("/api/contacts", async (c) => {
  const accessError = requireAccess(c, "contacts");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    company_name?: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  let companyId = body.company_id ?? null;
  if (!companyId && body.company_name) {
    const normalizedName = normalizeCompanyName(body.company_name);
    if (normalizedName) {
      const match = await c.env.DB
        .prepare("SELECT id FROM companies WHERE owner_email = ? AND LOWER(name) = ? LIMIT 1")
        .bind(ownerEmail, normalizedName)
        .first<{ id: number }>();
      if (match?.id) {
        companyId = match.id;
      }
    }
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO contacts (company_id, first_name, last_name, email, phone, role, status, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      companyId,
      body.first_name,
      body.last_name,
      body.email ?? null,
      body.phone ?? null,
      body.role ?? null,
      body.status ?? "Engaged",
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "contact", id, tags);

  await bumpCacheVersion(c.env, ownerEmail, "contacts");
  await bumpCacheVersion(c.env, ownerEmail, "companies");
  await bumpCacheVersion(c.env, ownerEmail, "products");
  await bumpCacheVersion(c.env, ownerEmail, "orders");
  await bumpCacheVersion(c.env, ownerEmail, "quotations");
  await bumpCacheVersion(c.env, ownerEmail, "invoices");
  await bumpCacheVersion(c.env, ownerEmail, "shipping_schedules");
  await bumpCacheVersion(c.env, ownerEmail, "sample_shipments");
  await bumpCacheVersion(c.env, ownerEmail, "tasks");
  await bumpCacheVersion(c.env, ownerEmail, "notes");
  return c.json({ id });
});

app.post("/api/companies", async (c) => {
  const accessError = requireAccess(c, "companies");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    id?: number;
    name: string;
    company_code?: string;
    website?: string;
    email?: string;
    phone?: string;
    owner?: string;
    industry?: string;
    status?: string;
    address?: string;
    tags?: Array<number | string>;
  }>();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const companyCode = typeof body.company_code === "string" ? body.company_code.trim() : null;
  const tags = normalizeTags(body.tags);
  const manualId = Number.isFinite(body.id ?? NaN) ? body.id : null;
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO companies (id, name, company_code, website, email, phone, owner, industry, status, address, owner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        manualId,
        name,
        companyCode ?? null,
        body.website ?? null,
        body.email ?? null,
        body.phone ?? null,
        body.owner ?? null,
        body.industry ?? null,
        body.status ?? "Active",
        body.address ?? null,
        ownerEmail
      )
      .run();

    const id = result.meta.last_row_id;
    await attachTags(c.env.DB, ownerEmail, "company", id, tags);

    return c.json({ id });
  } catch (err) {
    console.error("Create company failed", err);
    const message = err instanceof Error ? err.message : "Could not save company";
    return c.json({ error: message }, 400);
  }
});

app.post("/api/companies/bulk", async (c) => {
  const accessError = requireAccess(c, "companies");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<
    Array<{
      name: string;
      company_code?: string;
      website?: string;
      email?: string;
      phone?: string;
      owner?: string;
      industry?: string;
      status?: string;
      address?: string;
    }>
  >();

  if (!Array.isArray(body) || !body.length) {
    return c.json({ error: "No companies provided" }, 400);
  }

  try {
    const inserts = body.map((company) => {
      const name = typeof company.name === "string" ? company.name.trim() : "";
      if (!name) {
        throw new Error("Name is required for all companies");
      }
      const normalizeOptional = (value?: string) => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };
      const code = normalizeOptional(company.company_code);
      const website = normalizeOptional(company.website);
      const email = normalizeOptional(company.email);
      const phone = normalizeOptional(company.phone);
      const owner = normalizeOptional(company.owner);
      const industry = normalizeOptional(company.industry);
      const address = normalizeOptional(company.address);
      const statusValue = normalizeOptional(company.status);
      return c.env.DB.prepare(
        `INSERT OR IGNORE INTO companies (name, company_code, website, email, phone, owner, industry, status, address, owner_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'Active'), ?, ?)`
      ).bind(
        name,
        code,
        website,
        email,
        phone,
        owner,
        industry,
        statusValue,
        address,
        ownerEmail
      );
    });

    await batchInChunks(c.env.DB, inserts);
    await bumpCacheVersion(c.env, ownerEmail, "companies");
    return c.json({ inserted: inserts.length });
  } catch (err) {
    console.error("Bulk company insert failed", err);
    const message = err instanceof Error ? err.message : "Could not import companies";
    return c.json({ error: message }, 400);
  }
});

app.get("/api/companies/csv", async (c) => {
  const accessError = requireAccess(c, "companies");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const readDb = getReadSession(c.env.DB);
  const { results } = await readDb.prepare(
    `SELECT name, company_code, website, email, phone, owner, industry, status, address
     FROM companies
     WHERE owner_email = ?
     ORDER BY name`
  ).bind(ownerEmail).all();

  const header = ["name", "company_code", "website", "email", "phone", "owner", "industry", "status", "address"];
  const rows = (results ?? []).map((r) => header.map((key) => escapeCsv((r as any)[key])).join(","));
  const csv = [header.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=\"companies.csv\""
    }
  });
});

app.post("/api/products", async (c) => {
  const accessError = requireAccess(c, "products");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    name: string;
    sku?: string;
    category?: string;
    price?: number;
    currency?: string;
    status?: string;
    description?: string;
    tags?: Array<number | string>;
  }>();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return c.json({ error: "Name required" }, 400);
  }

  const tags = normalizeTags(body.tags);
  const sku = normalizeOptionalText(body.sku);
  const category = normalizeOptionalText(body.category);
  const currency = normalizeOptionalText(body.currency) ?? "USD";
  const status = normalizeOptionalText(body.status) ?? "Active";
  const description = normalizeOptionalText(body.description);
  const parsedPrice = typeof body.price === "number" ? body.price : Number(body.price);
  const price = Number.isFinite(parsedPrice) ? parsedPrice : 0;
  const result = await c.env.DB.prepare(
    `INSERT INTO products (name, sku, category, price, currency, status, description, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      name,
      sku,
      category,
      price,
      currency,
      status,
      description,
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "product", id, tags);

  return c.json({ id });
});

app.post("/api/contacts/bulk", async (c) => {
  const accessError = requireAccess(c, "contacts");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<
    Array<{
      company_id?: number;
      company_name?: string;
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
      role?: string;
      status?: string;
    }>
  >();

  if (!Array.isArray(body) || !body.length) {
    return c.json({ error: "No contacts provided" }, 400);
  }

  try {
    const needsNameLookup = body.some((contact) => !contact.company_id && contact.company_name);
    const needsIdValidation = body.some((contact) => Number.isFinite(contact.company_id));
    let companyLookup: Map<string, number> | null = null;
    let companyIdSet: Set<number> | null = null;

    if (needsNameLookup || needsIdValidation) {
      const { results } = await c.env.DB.prepare(
        "SELECT id, name FROM companies WHERE owner_email = ?"
      )
        .bind(ownerEmail)
        .all<{ id: number; name: string }>();

      companyIdSet = new Set<number>();
      companyLookup = new Map<string, number>();
      (results ?? []).forEach((row) => {
        if (Number.isFinite(row.id)) {
          companyIdSet?.add(row.id);
        }
        const normalized = normalizeCompanyName(row.name);
        if (normalized && Number.isFinite(row.id)) {
          companyLookup?.set(normalized, row.id);
        }
      });
    }

    const inserts = body.map((contact) => {
      const normalizedName = contact.company_name ? normalizeCompanyName(contact.company_name) : "";
      const providedId = Number.isFinite(contact.company_id) ? contact.company_id : null;
      const validCompanyId = providedId && companyIdSet?.has(providedId) ? providedId : null;
      const resolvedCompanyId =
        validCompanyId ??
        (normalizedName && companyLookup ? companyLookup.get(normalizedName) : null) ??
        null;
      const email = typeof contact.email === "string" ? contact.email.trim() : "";
      const normalizedEmail = email ? email.toLowerCase() : null;
      const phone = typeof contact.phone === "string" ? contact.phone.trim() : null;
      const role = typeof contact.role === "string" ? contact.role.trim() : null;
      const status = typeof contact.status === "string" ? contact.status.trim() : null;
      return c.env.DB
        .prepare(
          `INSERT INTO contacts (company_id, first_name, last_name, email, phone, role, status, owner_email)
           VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'Engaged'), ?)
           ON CONFLICT(owner_email, email) DO UPDATE SET
             company_id = CASE WHEN excluded.company_id IS NOT NULL THEN excluded.company_id ELSE contacts.company_id END,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             phone = CASE WHEN excluded.phone IS NOT NULL THEN excluded.phone ELSE contacts.phone END,
             role = CASE WHEN excluded.role IS NOT NULL THEN excluded.role ELSE contacts.role END,
             status = CASE WHEN excluded.status IS NOT NULL THEN excluded.status ELSE contacts.status END,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(
          resolvedCompanyId,
          contact.first_name,
          contact.last_name,
          normalizedEmail,
          phone,
          role,
          status,
          ownerEmail
        );
    });

    await batchInChunks(c.env.DB, inserts);
    await bumpCacheVersion(c.env, ownerEmail, "contacts");
    return c.json({ inserted: inserts.length });
  } catch (err) {
    console.error("Bulk contact insert failed", err);
    const message = err instanceof Error ? err.message : "Could not import contacts";
    return c.json({ error: message }, 400);
  }
});

app.get("/api/contacts/csv", async (c) => {
  const accessError = requireAccess(c, "contacts");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const readDb = getReadSession(c.env.DB);
  const { results } = await readDb.prepare(
    `SELECT c.company_id, co.name as company_name, c.first_name, c.last_name, c.email, c.phone, c.role, c.status
     FROM contacts c
     LEFT JOIN companies co ON co.id = c.company_id AND co.owner_email = ?
     WHERE c.owner_email = ?
     ORDER BY last_name, first_name`
  ).bind(ownerEmail, ownerEmail).all();

  const header = ["company_name", "company_id", "first_name", "last_name", "email", "phone", "role", "status"];
  const rows = (results ?? []).map((r) => header.map((key) => escapeCsv((r as any)[key])).join(","));
  const csv = [header.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=\"contacts.csv\""
    }
  });
});

app.post("/api/products/bulk", async (c) => {
  const accessError = requireAccess(c, "products");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<
    Array<{
      name: string;
      sku?: string;
      category?: string;
      price?: number;
      currency?: string;
      status?: string;
      description?: string;
    }>
  >();

  if (!Array.isArray(body) || !body.length) {
    return c.json({ error: "No products provided" }, 400);
  }

  const inserts: D1PreparedStatement[] = [];
  for (const product of body) {
    const name = typeof product.name === "string" ? product.name.trim() : "";
    if (!name) continue;
    const sku = normalizeOptionalText(product.sku);
    const category = normalizeOptionalText(product.category);
    const currency = normalizeOptionalText(product.currency) ?? "USD";
    const status = normalizeOptionalText(product.status) ?? "Active";
    const description = normalizeOptionalText(product.description);
    const parsedPrice = typeof product.price === "number" ? product.price : Number(product.price);
    const price = Number.isFinite(parsedPrice) ? parsedPrice : 0;

    inserts.push(
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO products (name, sku, category, price, currency, status, description, owner_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(name, sku, category, price, currency, status, description, ownerEmail)
    );
  }

  await batchInChunks(c.env.DB, inserts);
  await bumpCacheVersion(c.env, ownerEmail, "products");
  return c.json({ inserted: inserts.length });
});

app.get("/api/products/csv", async (c) => {
  const accessError = requireAccess(c, "products");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const readDb = getReadSession(c.env.DB);
  const { results } = await readDb.prepare(
    `SELECT name, sku, category, price, currency, status, description
     FROM products
     WHERE owner_email = ?
     ORDER BY name`
  ).bind(ownerEmail).all();

  const header = ["name", "sku", "category", "price", "currency", "status", "description"];
  const rows = (results ?? []).map((r) =>
    header
      .map((key) => {
        const val = (r as any)[key];
        if (val === null || val === undefined) return "";
        const str = String(val);
        const needsQuote = str.includes(",") || str.includes("\"") || str.includes("\n");
        return needsQuote ? `"${str.replace(/\"/g, '""')}"` : str;
      })
      .join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": "attachment; filename=\"products.csv\""
    }
  });
});

app.post("/api/orders", async (c) => {
  const accessError = requireAccess(c, "orders");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    contact_id?: number;
    quotation_id?: number;
    invoice_ids?: Array<number | string> | string;
    invoice_links?: Array<number | string> | string;
    status?: string;
    total_amount?: number;
    currency?: string;
    reference?: string;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  const invoiceIds = normalizeInvoiceIds(body.invoice_ids ?? body.invoice_links);
  const ref = body.reference || generateRef("SO");
  const result = await c.env.DB.prepare(
    `INSERT INTO orders (company_id, contact_id, quotation_id, invoice_ids, status, total_amount, currency, reference, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.company_id ?? null,
      body.contact_id ?? null,
      body.quotation_id ?? null,
      invoiceIds,
      body.status ?? "Pending",
      body.total_amount ?? 0,
      body.currency ?? "USD",
      ref,
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "order", id, tags);

  return c.json({ id, reference: ref });
});

app.post("/api/quotations", async (c) => {
  const accessError = requireAccess(c, "quotations");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    contact_id?: number;
    reference?: string;
    amount?: number;
    currency?: string;
    exchange_rate?: number;
    status?: string;
    valid_until?: string;
    title?: string;
    tax_rate?: number;
    notes?: string;
    bank_charge_method?: string;
    attachment_key?: string;
    tags?: Array<number | string>;
    items?: Array<{
      product_id?: number;
      product_name?: string;
      qty?: number;
      unit_price?: number;
      drums_price?: number;
      bank_charge_price?: number;
      shipping_price?: number;
      customer_commission?: number;
      line_total?: number;
    }>;
  }>();

  const tags = normalizeTags(body.tags);
  const ref = body.reference || generateRef("Q");
  const exchangeRate = normalizeNonNegativeNumber(body.exchange_rate);
  const result = await c.env.DB.prepare(
    `INSERT INTO quotations (company_id, contact_id, reference, amount, currency, exchange_rate, status, valid_until, title, tax_rate, notes, bank_charge_method, attachment_key, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.company_id ?? null,
      body.contact_id ?? null,
      ref,
      body.amount ?? 0,
      body.currency ?? "USD",
      exchangeRate,
      body.status ?? "Draft",
      body.valid_until ?? null,
      body.title ?? null,
      body.tax_rate ?? 0,
      body.notes ?? null,
      body.bank_charge_method ?? null,
      body.attachment_key ?? null,
      ownerEmail
    )
    .run();

  const quotationId = result.meta.last_row_id;

  if (Array.isArray(body.items) && body.items.length) {
    const inserts = body.items.map((item) =>
      c.env.DB.prepare(
        `INSERT INTO quotation_items (quotation_id, product_id, product_name, qty, unit_price, drums_price, bank_charge_price, shipping_price, customer_commission, line_total, owner_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        quotationId,
        item.product_id ?? null,
        item.product_name ?? null,
        item.qty ?? 0,
        item.unit_price ?? 0,
        item.drums_price ?? 0,
        item.bank_charge_price ?? 0,
        item.shipping_price ?? 0,
        item.customer_commission ?? 0,
        item.line_total ?? 0,
        ownerEmail
      )
    );
    await batchInChunks(c.env.DB, inserts);
  }

  await attachTags(c.env.DB, ownerEmail, "quotation", quotationId, tags);
  await bumpCacheVersion(c.env, ownerEmail, "quotations");
  await bumpCacheVersion(c.env, ownerEmail, "quotation_items");

  return c.json({ id: quotationId, reference: ref });
});

app.post("/api/invoices", async (c) => {
  const accessError = requireAccess(c, "invoices");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    contact_id?: number;
    reference?: string;
    total_amount?: number;
    currency?: string;
    due_date?: string;
    status?: string;
    attachment_key?: string;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  const ref = body.reference || generateRef("INV");
  const result = await c.env.DB.prepare(
    `INSERT INTO invoices (company_id, contact_id, reference, total_amount, currency, due_date, status, attachment_key, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.company_id ?? null,
      body.contact_id ?? null,
      ref,
      body.total_amount ?? 0,
      body.currency ?? "USD",
      body.due_date ?? null,
      body.status ?? "Open",
      body.attachment_key ?? null,
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "invoice", id, tags);

  return c.json({ id, reference: ref });
});

app.post("/api/shipping_schedules", async (c) => {
  const accessError = requireAccess(c, "shipping");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    order_id?: number;
    invoice_id?: number;
    company_id?: number;
    company_name?: string;
    carrier?: string;
    tracking_number?: string;
    factory_exit_date?: string;
    etc_date?: string;
    etd_date?: string;
    eta?: string;
    status?: string;
    notes?: string;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  let companyId = body.company_id ?? null;
  if (!companyId && body.company_name) {
    const normalizedName = normalizeCompanyName(body.company_name);
    if (normalizedName) {
      const match = await c.env.DB
        .prepare("SELECT id FROM companies WHERE owner_email = ? AND LOWER(name) = ? LIMIT 1")
        .bind(ownerEmail, normalizedName)
        .first<{ id: number }>();
      if (match?.id) {
        companyId = match.id;
      }
    }
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO shipping_schedules (order_id, invoice_id, company_id, carrier, tracking_number, factory_exit_date, etc_date, etd_date, eta, status, notes, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.order_id ?? null,
      body.invoice_id ?? null,
      companyId,
      body.carrier ?? null,
      body.tracking_number ?? null,
      body.factory_exit_date ?? null,
      body.etc_date ?? null,
      body.etd_date ?? null,
      body.eta ?? null,
      body.status ?? "Factory exit",
      body.notes ?? null,
      ownerEmail
  )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "shipping", id, tags);
  await syncShippingMilestones(c.env.DB, ownerEmail);

  return c.json({ id });
});

app.post("/api/sample_shipments", async (c) => {
  const accessError = requireAccess(c, "sample_shipments");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    product_id?: number;
    document_id?: number;
    receiving_address?: string;
    phone?: string;
    quantity?: number;
    waybill_number?: string;
    courier?: string;
    status?: string;
    notes?: string;
  }>();

  const quantity = normalizeNonNegativeNumber(body.quantity);
  if (quantity === null) {
    return c.json({ error: "Quantity must be 0 or greater" }, 400);
  }

  const result = await c.env.DB
    .prepare(
      `INSERT INTO sample_shipments (company_id, product_id, document_id, receiving_address, phone, quantity, waybill_number, courier, status, notes, owner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body.company_id ?? null,
      body.product_id ?? null,
      body.document_id ?? null,
      body.receiving_address ?? null,
      body.phone ?? null,
      quantity,
      body.waybill_number ?? null,
      body.courier ?? null,
      body.status ?? "Preparing",
      body.notes ?? null,
      ownerEmail
    )
    .run();

  return c.json({ id: result.meta.last_row_id });
});

app.post("/api/tasks", async (c) => {
  const accessError = requireAccess(c, "tasks");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    title: string;
    status?: string;
    due_date?: string;
    assignee?: string;
    related_type?: string;
    related_id?: number;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  const result = await c.env.DB.prepare(
    `INSERT INTO tasks (title, status, due_date, assignee, related_type, related_id, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      body.status ?? "Not Started",
      body.due_date ?? null,
      body.assignee ?? null,
      body.related_type ?? null,
      body.related_id ?? null,
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "task", id, tags);
  await bumpCacheVersion(c.env, ownerEmail, "tasks");

  return c.json({ id });
});

app.post("/api/notes", async (c) => {
  const accessError = requireAccess(c, "notes");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    entity_type: string;
    entity_id?: number;
    body: string;
    author?: string;
    note_date?: string;
    tags?: Array<number | string>;
  }>();

  const tags = normalizeTags(body.tags);
  const result = await c.env.DB.prepare(
    `INSERT INTO notes (entity_type, entity_id, body, author, note_date, owner_email)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(body.entity_type, body.entity_id ?? null, body.body, body.author ?? null, body.note_date ?? null, ownerEmail)
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "note", id, tags);
  await bumpCacheVersion(c.env, ownerEmail, "notes");

  return c.json({ id });
});

app.post("/api/tags", async (c) => {
  const accessError = requireAccess(c, "tags");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{ name: string; color?: string }>();
  const result = await c.env.DB.prepare(`INSERT INTO tags (name, color, owner_email) VALUES (?, ?, ?)`)
    .bind(body.name, body.color ?? "#2563eb", ownerEmail)
    .run();

  await bumpCacheVersions(c.env, ownerEmail, ["tags", ...TAGGED_LIST_TABLES]);
  return c.json({ id: result.meta.last_row_id });
});

app.delete("/api/tags/:id", async (c) => {
  const accessError = requireAccess(c, "tags");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM tags WHERE id = ? AND owner_email = ?").bind(id, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, ["tags", ...TAGGED_LIST_TABLES]);
  return c.json({ ok: true });
});

app.post("/api/doc_types", async (c) => {
  const accessError = requireAccess(c, "tags");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{ name: string }>();
  if (!body.name) return c.json({ error: "name is required" }, 400);
  const result = await c.env.DB.prepare(`INSERT INTO doc_types (name, owner_email) VALUES (?, ?)`).bind(body.name, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, DOC_TYPE_LIST_TABLES);
  return c.json({ id: result.meta.last_row_id });
});

app.delete("/api/doc_types/:id", async (c) => {
  const accessError = requireAccess(c, "tags");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM doc_types WHERE id = ? AND owner_email = ?").bind(id, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, DOC_TYPE_LIST_TABLES);
  return c.json({ ok: true });
});

app.post("/api/documents", async (c) => {
  const accessError = requireAccess(c, "documents");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    title: string;
    key: string;
    companyId?: number;
    contactId?: number;
    invoiceId?: number;
    docTypeId?: number;
    contentType?: string;
    size?: number;
    tags?: Array<number | string>;
  }>();

  if (!body.title || !body.key) {
    return c.json({ error: "title and key are required" }, 400);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO documents (company_id, contact_id, invoice_id, doc_type_id, title, storage_key, content_type, size, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, title, storage_key AS key`
  )
    .bind(
      body.companyId ?? null,
      body.contactId ?? null,
      body.invoiceId ?? null,
      body.docTypeId ?? null,
      body.title,
      body.key,
      body.contentType ?? null,
      body.size ?? null,
      ownerEmail
    )
    .first();

  const docId = typeof row?.id === "number" ? row.id : null;
  await attachTags(c.env.DB, ownerEmail, "document", docId, normalizeTags(body.tags));

  await bumpCacheVersion(c.env, ownerEmail, "documents");
  return c.json({ document: row });
});

app.put("/api/files/:key{.+}", async (c) => {
  const accessError = requireAccess(c, "documents");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const keyParam = c.req.param("key");
  const key = decodeURIComponent(keyParam || "");
  if (!key || key.includes("..") || !key.startsWith("uploads/")) {
    return c.text("Missing file key", 400);
  }

  const readDb = getReadSession(c.env.DB);
  const existing = await readDb
    .prepare("SELECT owner_email FROM documents WHERE storage_key = ? LIMIT 1")
    .bind(key)
    .first<{ owner_email?: string | null }>();
  if (existing && existing.owner_email && existing.owner_email !== ownerEmail) {
    return c.text("Forbidden", 403);
  }

  let body: ArrayBuffer | null = null;
  try {
    body = await c.req.arrayBuffer();
  } catch (err) {
    console.error("Failed to read upload body", err);
    return c.text("Invalid file body", 400);
  }

  if (!body || !body.byteLength) {
    return c.text("Missing file body", 400);
  }

  const contentType = normalizeContentType(c.req.header("content-type"));
  if (!allowedUploadContentTypes.has(contentType)) {
    return c.text("Unsupported file type", 415);
  }
  await c.env.FILES.put(key, body, { httpMetadata: { contentType } });

  return c.json({ key });
});

app.post("/api/upload", async (c) => {
  const accessError = requireAccess(c, "documents");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const formData = await c.req.formData();
  const title = formData.get("title")?.toString() || "Untitled document";
  const companyId = Number(formData.get("company_id")) || null;
  const contactId = Number(formData.get("contact_id")) || null;
  const invoiceId = Number(formData.get("invoice_id")) || null;
  const docTypeId = Number(formData.get("doc_type_id")) || null;
  const tagsRaw = formData.getAll("tags");
  const tags = Array.from(tagsRaw).map(Number).filter(isFinite);

  const files = formData.getAll("file") as File[];
  if (!files.length) {
    return c.json({ error: "No files provided" }, 400);
  }

  const results = [];
  for (const file of files) {
    if (!file || file.size === 0) continue;

    const uuid = crypto.randomUUID?.() || Array.from({length:8}, () => Math.random().toString(16).slice(2)).join('');
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `uploads/${uuid}-${safeName}`;

    const body = await file.arrayBuffer();
    if (body.byteLength === 0) {
      console.error("Empty body from file.arrayBuffer()");
      continue;
    }

    const contentType = normalizeContentType(file.type || "application/octet-stream");
    if (!allowedUploadContentTypes.has(contentType)) {
      return c.json({ error: "Unsupported file type" }, 415);
    }
    await c.env.FILES.put(key, body, { httpMetadata: { contentType } });

    const stmt = c.env.DB.prepare(`
      INSERT INTO documents (company_id, contact_id, invoice_id, doc_type_id, title, storage_key, content_type, size, owner_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, title, storage_key as key
    `).bind(companyId, contactId, invoiceId, docTypeId, title, key, contentType, body.byteLength, ownerEmail);

    const doc = await stmt.first();
    if (doc && tags.length && typeof doc.id === 'number') {
      await attachTags(c.env.DB, ownerEmail, "document", doc.id, tags);
    }

    results.push({ key, document: doc });
  }

  if (results.length) {
    await bumpCacheVersion(c.env, ownerEmail, "documents");
  }
  return c.json({ success: true, uploaded: results.length, documents: results });
});

app.get("/api/files/:key{.+}", async (c) => {
  const accessError = requireAccess(c, "documents");
  if (accessError) return accessError;
  const ownerEmail = c.get("ownerEmail");
  const keyParam = c.req.param("key");
  const key = decodeURIComponent(keyParam || "");
  if (!key) {
    return c.notFound();
  }

  const readDb = getReadSession(c.env.DB);
  let record = await readDb
    .prepare("SELECT id FROM documents WHERE storage_key = ? AND owner_email = ?")
    .bind(key, ownerEmail)
    .first();
  if (!record) {
    const attachment = await readDb
      .prepare(
        `SELECT id FROM quotations WHERE attachment_key = ? AND owner_email = ?
         UNION
         SELECT id FROM invoices WHERE attachment_key = ? AND owner_email = ?
         LIMIT 1`
      )
      .bind(key, ownerEmail, key, ownerEmail)
      .first();
    if (!attachment) {
      return c.notFound();
    }
  }

  const object = await c.env.FILES.get(key);

  if (!object) {
    return c.notFound();
  }

  const filename = key.split("/").pop() || "file";

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
});

app.onError((err, c) => {
  console.error("Worker error", err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound(async (c) => serveAsset(c));

export default app;

type UniqueTableConfig = {
  table: string;
  uniqueColumns: string[];
};

async function hasSingleColumnUniqueIndex(db: D1Database, table: string, column: string) {
  const indexes = await db
    .prepare(`PRAGMA index_list(${table})`)
    .bind()
    .all<{ name: string; unique: number }>();
  for (const idx of indexes.results ?? []) {
    if (!idx.unique || !idx.name) continue;
    const info = await db
      .prepare(`PRAGMA index_info(${idx.name})`)
      .bind()
      .all<{ name: string }>();
    const columns = info.results?.map((row) => row.name) ?? [];
    if (columns.length === 1 && columns[0] === column) {
      return true;
    }
  }
  return false;
}

async function rebuildOwnerScopedTable(db: D1Database, table: string) {
  const createTemplate = schemaCreateStatements.get(table);
  if (!createTemplate) return false;
  const columnsInfo = await db
    .prepare(`PRAGMA table_info(${table})`)
    .bind()
    .all<{ name: string }>();
  const columns = columnsInfo.results?.map((row) => row.name) ?? [];
  if (!columns.length) return false;

  const createSql = createTemplate.replace(
    `CREATE TABLE IF NOT EXISTS ${table}`,
    `CREATE TABLE ${table}_new`
  );
  const quotedColumns = columns.map((col) => `"${col}"`).join(", ");
  const selectColumns = columns
    .map((col) => (col === "owner_email" ? "COALESCE(owner_email, '')" : `"${col}"`))
    .join(", ");

  await db.prepare(`DROP TABLE IF EXISTS ${table}_new`).bind().run();
  await db.prepare("PRAGMA foreign_keys = OFF").bind().run();
  await db.prepare(createSql).bind().run();
  await db.prepare(`INSERT INTO ${table}_new (${quotedColumns}) SELECT ${selectColumns} FROM ${table}`).bind().run();
  await db.prepare(`DROP TABLE ${table}`).bind().run();
  await db.prepare(`ALTER TABLE ${table}_new RENAME TO ${table}`).bind().run();
  await db.prepare("PRAGMA foreign_keys = ON").bind().run();
  return true;
}

async function rebuildOwnerUniqueTables(db: D1Database) {
  const targets: UniqueTableConfig[] = [
    { table: "companies", uniqueColumns: ["name", "company_code"] },
    { table: "contacts", uniqueColumns: ["email"] },
    { table: "products", uniqueColumns: ["sku"] },
    { table: "orders", uniqueColumns: ["reference"] },
    { table: "quotations", uniqueColumns: ["reference"] },
    { table: "invoices", uniqueColumns: ["reference"] },
    { table: "tags", uniqueColumns: ["name"] },
    { table: "doc_types", uniqueColumns: ["name"] }
  ];

  let rebuilt = false;
  for (const target of targets) {
    const hasTable = await db
      .prepare(`PRAGMA table_info(${target.table})`)
      .bind()
      .all<{ name: string }>();
    if (!hasTable.results || hasTable.results.length === 0) continue;
    let needsRebuild = false;
    for (const column of target.uniqueColumns) {
      if (await hasSingleColumnUniqueIndex(db, target.table, column)) {
        needsRebuild = true;
        break;
      }
    }
    if (needsRebuild) {
      const didRebuild = await rebuildOwnerScopedTable(db, target.table);
      rebuilt = rebuilt || didRebuild;
    }
  }

  if (rebuilt) {
    await db.batch(schemaIndexStatements.map((sql) => db.prepare(sql).bind()));
  }
}

async function ensureSchema(db: D1Database) {
  if (schemaInitialized) return;
  await db.batch(schemaStatements.map((sql) => db.prepare(sql).bind()));

  // Backfill note_date if missing on existing databases
  const noteColumns = await db.prepare("PRAGMA table_info(notes)").bind().all<{ name: string }>();
  const hasNoteDate = noteColumns.results?.some((c) => c.name === "note_date");
  if (!hasNoteDate) {
    await db.prepare("ALTER TABLE notes ADD COLUMN note_date TEXT").bind().run();
  }

  const companyColumns = await db.prepare("PRAGMA table_info(companies)").bind().all<{ name: string }>();
  const companyNames = new Set(companyColumns.results?.map((c) => c.name));
  if (companyNames.size && !companyNames.has("company_code")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN company_code TEXT").bind().run();
  }
  if (companyNames.size && !companyNames.has("address")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN address TEXT").bind().run();
  }
  if (companyNames.size && !companyNames.has("industry")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN industry TEXT").bind().run();
  }

  const shipColumns = await db.prepare("PRAGMA table_info(shipping_schedules)").bind().all<{ name: string }>();
  const shipNames = new Set(shipColumns.results?.map((c) => c.name));
  if (shipNames.size) {
    if (!shipNames.has("invoice_id")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN invoice_id INTEGER").bind().run();
    if (!shipNames.has("company_id")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN company_id INTEGER").bind().run();
    if (!shipNames.has("factory_exit_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN factory_exit_date TEXT").bind().run();
    if (!shipNames.has("etc_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN etc_date TEXT").bind().run();
    if (!shipNames.has("etd_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN etd_date TEXT").bind().run();
  }

  const sampleColumns = await db.prepare("PRAGMA table_info(sample_shipments)").bind().all<{ name: string }>();
  const sampleNames = new Set(sampleColumns.results?.map((c) => c.name));
  if (sampleNames.size) {
    if (!sampleNames.has("document_id")) await db.prepare("ALTER TABLE sample_shipments ADD COLUMN document_id INTEGER").bind().run();
  }

  const docColumns = await db.prepare("PRAGMA table_info(documents)").bind().all<{ name: string }>();
  const docNames = new Set(docColumns.results?.map((c) => c.name));
  if (docNames.size) {
    if (!docNames.has("invoice_id")) await db.prepare("ALTER TABLE documents ADD COLUMN invoice_id INTEGER").bind().run();
    if (!docNames.has("doc_type_id")) await db.prepare("ALTER TABLE documents ADD COLUMN doc_type_id INTEGER").bind().run();
  }

  const orderColumns = await db.prepare("PRAGMA table_info(orders)").bind().all<{ name: string }>();
  const orderNames = new Set(orderColumns.results?.map((c) => c.name));
  if (orderNames.size && !orderNames.has("quotation_id")) {
    await db.prepare("ALTER TABLE orders ADD COLUMN quotation_id INTEGER").bind().run();
  }
  if (orderNames.size && !orderNames.has("invoice_ids")) {
    await db.prepare("ALTER TABLE orders ADD COLUMN invoice_ids TEXT").bind().run();
  }

  const quoteColumns = await db.prepare("PRAGMA table_info(quotations)").bind().all<{ name: string }>();
  const quoteNames = new Set(quoteColumns.results?.map((c) => c.name));
  if (quoteNames.size) {
    if (!quoteNames.has("title")) await db.prepare("ALTER TABLE quotations ADD COLUMN title TEXT").bind().run();
    if (!quoteNames.has("tax_rate")) await db.prepare("ALTER TABLE quotations ADD COLUMN tax_rate REAL DEFAULT 0").bind().run();
    if (!quoteNames.has("exchange_rate")) await db.prepare("ALTER TABLE quotations ADD COLUMN exchange_rate REAL").bind().run();
    if (!quoteNames.has("notes")) await db.prepare("ALTER TABLE quotations ADD COLUMN notes TEXT").bind().run();
    if (!quoteNames.has("bank_charge_method")) await db.prepare("ALTER TABLE quotations ADD COLUMN bank_charge_method TEXT").bind().run();
    if (!quoteNames.has("attachment_key")) await db.prepare("ALTER TABLE quotations ADD COLUMN attachment_key TEXT").bind().run();
  }

  const invoiceColumns = await db.prepare("PRAGMA table_info(invoices)").bind().all<{ name: string }>();
  const invoiceNames = new Set(invoiceColumns.results?.map((c) => c.name));
  if (invoiceNames.size) {
    if (!invoiceNames.has("attachment_key")) await db.prepare("ALTER TABLE invoices ADD COLUMN attachment_key TEXT").bind().run();
  }

  const configColumns = await db.prepare("PRAGMA table_info(site_config)").bind().all<{ name: string }>();
  const configNames = new Set(configColumns.results?.map((c) => c.name));
  if (configNames.size) {
    if (!configNames.has("ai_provider")) await db.prepare("ALTER TABLE site_config ADD COLUMN ai_provider TEXT").bind().run();
    if (!configNames.has("ai_api_url")) await db.prepare("ALTER TABLE site_config ADD COLUMN ai_api_url TEXT").bind().run();
    if (!configNames.has("ai_api_key")) await db.prepare("ALTER TABLE site_config ADD COLUMN ai_api_key TEXT").bind().run();
    if (!configNames.has("ai_model")) await db.prepare("ALTER TABLE site_config ADD COLUMN ai_model TEXT").bind().run();
  }

  for (const table of ownerEmailTables) {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).bind().all<{ name: string }>();
    const names = new Set(columns.results?.map((c) => c.name));
    if (names.size && !names.has("owner_email")) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN owner_email TEXT`).bind().run();
    }
  }

  await rebuildOwnerUniqueTables(db);

  schemaInitialized = true;
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function computeShippingMilestoneStatus(row: {
  factory_exit_date?: string | null;
  etc_date?: string | null;
  etd_date?: string | null;
  eta?: string | null;
}, nowMs: number) {
  const etaMs = parseDateMs(row.eta);
  if (etaMs !== null && etaMs <= nowMs) return "Delivered";
  const etdMs = parseDateMs(row.etd_date);
  if (etdMs !== null && etdMs <= nowMs) return "Shipped";
  const etcMs = parseDateMs(row.etc_date);
  if (etcMs !== null && etcMs <= nowMs) return "Cut Off";
  const factoryMs = parseDateMs(row.factory_exit_date);
  if (factoryMs !== null && factoryMs <= nowMs) return "Dispatched";
  return null;
}

async function syncShippingMilestones(db: D1Database, ownerEmail: string) {
  const { results } = await db
    .prepare(
      `SELECT id, status, order_id, invoice_id, factory_exit_date, etc_date, etd_date, eta
       FROM shipping_schedules WHERE owner_email = ?`
    )
    .bind(ownerEmail)
    .all<{
      id: number;
      status?: string | null;
      order_id: number | null;
      invoice_id: number | null;
      factory_exit_date?: string | null;
      etc_date?: string | null;
      etd_date?: string | null;
      eta?: string | null;
    }>();

  if (!results?.length) return;

  const nowMs = Date.now();
  const orderStatuses = new Map<number, string>();
  const invoiceStatuses = new Map<number, string>();
  const updateSchedule = db.prepare(
    `UPDATE shipping_schedules
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)`
  );
  const scheduleUpdates: D1PreparedStatement[] = [];

  const applyStatus = (target: Map<number, string>, id: number, status: string) => {
    const current = target.get(id);
    if (!current || shippingStatusRank[status] > shippingStatusRank[current]) {
      target.set(id, status);
    }
  };

  for (const row of results) {
    const computedStatus = computeShippingMilestoneStatus(row, nowMs);
    if (!computedStatus) continue;
    if (row.status !== computedStatus) {
      scheduleUpdates.push(updateSchedule.bind(computedStatus, row.id, ownerEmail, computedStatus));
    }
    if (row.order_id) applyStatus(orderStatuses, row.order_id, computedStatus);
    if (row.invoice_id) applyStatus(invoiceStatuses, row.invoice_id, computedStatus);
  }

  if (scheduleUpdates.length) {
    await batchInChunks(db, scheduleUpdates);
  }

  if (orderStatuses.size) {
    const updateOrder = db.prepare(
      `UPDATE orders
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)`
    );
    const orderUpdates: D1PreparedStatement[] = [];
    for (const [id, status] of orderStatuses.entries()) {
      orderUpdates.push(updateOrder.bind(status, id, ownerEmail, status));
    }
    if (orderUpdates.length) {
      await batchInChunks(db, orderUpdates);
    }
  }

  if (invoiceStatuses.size) {
    const updateInvoice = db.prepare(
      `UPDATE invoices
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)`
    );
    const invoiceUpdates: D1PreparedStatement[] = [];
    for (const [id, status] of invoiceStatuses.entries()) {
      invoiceUpdates.push(updateInvoice.bind(status, id, ownerEmail, status));
    }
    if (invoiceUpdates.length) {
      await batchInChunks(db, invoiceUpdates);
    }
  }
}

async function getStats(db: D1Queryable, ownerEmail: string) {
  const tables = ["companies", "contacts", "orders", "quotations", "invoices", "tasks"];
  const statements = tables.map((table) =>
    db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE owner_email = ?`).bind(ownerEmail)
  );
  const results = await db.batch<{ count: number }>(statements);
  const output: Record<string, number> = {};
  results.forEach((res, index) => {
    const row = res.results?.[0] as { count: number } | undefined;
    const key = tables[index] === "orders" ? "openOrders" : tables[index];
    output[key] = row?.count ?? 0;
  });
  return output;
}

async function fetchRows(
  db: D1Queryable,
  table: string,
  ownerEmail: string,
  filters: Array<{ column: string; value: string | number }>,
  limit: number,
  offset: number
) {
  const orderColumn = table === "tags" || table === "doc_types" ? "created_at" : "updated_at";
  const baseColumns = tableColumns[table] ?? ["*"];
  const baseWhere = buildWhereClause(ownerEmail, filters);
  let query = `SELECT ${baseColumns.join(", ")} FROM ${table} WHERE ${baseWhere.clause} ORDER BY ${orderColumn} DESC LIMIT ? OFFSET ?`;
  let params: unknown[] = [...baseWhere.params, limit, offset];

  switch (table) {
    case "contacts":
      {
        const where = buildWhereClause(ownerEmail, filters, "c");
      query = `SELECT ${selectColumns("c", tableColumns.contacts)}, co.name as company_name 
               FROM contacts c 
               LEFT JOIN companies co ON co.id = c.company_id AND co.owner_email = ?
               WHERE ${where.clause}
               ORDER BY c.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "products":
      {
        const where = buildWhereClause(ownerEmail, filters, "p");
      query = `SELECT ${selectColumns("p", tableColumns.products)}, GROUP_CONCAT(DISTINCT tl.tag_id) as tags
               FROM products p
               LEFT JOIN tag_links tl ON tl.entity_type = 'product' AND tl.entity_id = p.id AND tl.owner_email = ?
               WHERE ${where.clause}
               GROUP BY p.id
               ORDER BY p.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "orders":
      {
        const where = buildWhereClause(ownerEmail, filters, "o");
      query = `SELECT ${selectColumns("o", tableColumns.orders)}, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name,
               GROUP_CONCAT(DISTINCT t.name) as tags
               FROM orders o
               LEFT JOIN companies co ON co.id = o.company_id AND co.owner_email = ?
               LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.owner_email = ?
               LEFT JOIN tag_links tl ON tl.entity_type = 'order' AND tl.entity_id = o.id AND tl.owner_email = ?
               LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ?
               WHERE ${where.clause}
               GROUP BY o.id
               ORDER BY o.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "quotations":
      {
        const where = buildWhereClause(ownerEmail, filters, "q");
      query = `SELECT ${selectColumns("q", tableColumns.quotations)}, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name,
               GROUP_CONCAT(DISTINCT t.name) as tags
               FROM quotations q
               LEFT JOIN companies co ON co.id = q.company_id AND co.owner_email = ?
               LEFT JOIN contacts ct ON ct.id = q.contact_id AND ct.owner_email = ?
               LEFT JOIN tag_links tl ON tl.entity_type = 'quotation' AND tl.entity_id = q.id AND tl.owner_email = ?
               LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ?
               WHERE ${where.clause}
               GROUP BY q.id
               ORDER BY q.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "invoices":
      {
        const where = buildWhereClause(ownerEmail, filters, "i");
      query = `SELECT ${selectColumns("i", tableColumns.invoices)}, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name
               FROM invoices i
               LEFT JOIN companies co ON co.id = i.company_id AND co.owner_email = ?
               LEFT JOIN contacts ct ON ct.id = i.contact_id AND ct.owner_email = ?
               WHERE ${where.clause}
               ORDER BY i.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "documents":
      {
        const where = buildWhereClause(ownerEmail, filters, "d");
      query = `SELECT ${selectColumns("d", tableColumns.documents)}, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name,
               dt.name as doc_type_name, i.reference as invoice_reference, GROUP_CONCAT(DISTINCT t.name) as tags
               FROM documents d
               LEFT JOIN companies co ON co.id = d.company_id AND co.owner_email = ?
               LEFT JOIN contacts ct ON ct.id = d.contact_id AND ct.owner_email = ?
               LEFT JOIN doc_types dt ON dt.id = d.doc_type_id AND dt.owner_email = ?
               LEFT JOIN invoices i ON i.id = d.invoice_id AND i.owner_email = ?
               LEFT JOIN tag_links tl ON tl.entity_type = 'document' AND tl.entity_id = d.id AND tl.owner_email = ?
               LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ?
               WHERE ${where.clause}
               GROUP BY d.id
               ORDER BY d.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ownerEmail, ownerEmail, ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "shipping_schedules":
      {
        const where = buildWhereClause(ownerEmail, filters, "ss");
      query = `SELECT ${selectColumns("ss", tableColumns.shipping_schedules)}, o.reference as order_reference, i.reference as invoice_reference, co.name as company_name
               FROM shipping_schedules ss
               LEFT JOIN orders o ON o.id = ss.order_id AND o.owner_email = ?
               LEFT JOIN invoices i ON i.id = ss.invoice_id AND i.owner_email = ?
               LEFT JOIN companies co ON co.id = ss.company_id AND co.owner_email = ?
               WHERE ${where.clause}
               ORDER BY ss.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "sample_shipments":
      {
        const where = buildWhereClause(ownerEmail, filters, "ss");
      query = `SELECT ${selectColumns("ss", tableColumns.sample_shipments)}, co.name as company_name, p.name as product_name, d.title as document_title
               FROM sample_shipments ss
               LEFT JOIN companies co ON co.id = ss.company_id AND co.owner_email = ?
               LEFT JOIN products p ON p.id = ss.product_id AND p.owner_email = ?
               LEFT JOIN documents d ON d.id = ss.document_id AND d.owner_email = ?
               WHERE ${where.clause}
               ORDER BY ss.${orderColumn} DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ownerEmail, ownerEmail, ...where.params, limit, offset];
      }
      break;
    case "quotation_items":
      {
        const where = buildWhereClause(ownerEmail, filters, "qi");
      query = `SELECT ${selectColumns("qi", tableColumns.quotation_items)}, p.name as product_name
              FROM quotation_items qi
              LEFT JOIN products p ON p.id = qi.product_id AND p.owner_email = ?
              WHERE ${where.clause}
              ORDER BY qi.created_at DESC LIMIT ? OFFSET ?`;
      params = [ownerEmail, ...where.params, limit, offset];
      }
      break;
  }

  const { results } = await db.prepare(query).bind(...params).all();
  return results ?? [];
}

function normalizeOptionalText(value?: string | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNonNegativeNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function normalizeTags(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n));
}

function normalizeInvoiceIds(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    const ids = raw.map((val) => String(val).trim()).filter(Boolean);
    return ids.length ? ids.join(",") : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const ids = parsed.map((val) => String(val).trim()).filter(Boolean);
          return ids.length ? ids.join(",") : null;
        }
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  const str = String(raw).trim();
  return str ? str : null;
}

type UserRow = {
  id: number;
  email: string;
  name?: string | null;
  role?: string | null;
  access?: string | null;
  access_list?: string | null;
  password_hash?: string | null;
  password_salt?: string | null;
  enabled?: number | null;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const validateOwnerParam = (ownerEmail: string, searchParams: URLSearchParams) => {
  const ownerParam = searchParams.get("owner_email");
  if (!ownerParam) return null;
  const normalized = normalizeEmail(ownerParam);
  if (normalized !== ownerEmail) {
    return "Owner mismatch";
  }
  return null;
};

const parseAccessListRaw = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item)).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      return raw
        .split(/[^a-z0-9_]+/i)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return [];
};

const normalizeAccessList = (raw: unknown): string[] => {
  const list = parseAccessListRaw(raw);
  const unique = new Set<string>();
  list.forEach((item) => {
    if (item) unique.add(item);
  });
  return Array.from(unique.values());
};

const hasAccess = (user: UserRow, accessList: string[], required?: string) => {
  if (!required) return true;
  if ((user.role || adminRole) === adminRole) return true;
  const normalized = new Set(accessList.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return normalized.has(required);
};

const truncateAiText = (value: string, limit = AI_TEXT_TRUNCATE) => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
};

const sanitizeAiRecord = (row: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "owner_email") continue;
    if (typeof value === "string") {
      output[key] = truncateAiText(value);
    } else {
      output[key] = value;
    }
  }
  return output;
};

const normalizeAiTables = (raw: unknown, user: UserRow, accessList: string[]) => {
  const requested = Array.isArray(raw)
    ? raw.map((item) => String(item).trim()).filter(Boolean)
    : AI_DEFAULT_TABLES;
  const unique = Array.from(new Set(requested));
  const filtered = unique.filter((table) => allowedTables.includes(table));
  const accessFiltered = filtered.filter((table) => {
    const accessId = accessByTable[table];
    return accessId ? hasAccess(user, accessList, accessId) : false;
  });
  return accessFiltered.slice(0, AI_MAX_TABLES);
};

const normalizeAiLimit = (raw: unknown) => {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(Math.trunc(parsed), 1), AI_MAX_TABLE_ROWS);
};

const parseAiJson = (raw: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
};

const requireAccess = (c: Context, accessId?: string) => {
  if (!accessId) return null;
  const user = c.get("currentUser") as UserRow | undefined;
  const accessList = (c.get("accessList") as string[] | undefined) ?? [];
  if (!user || !hasAccess(user, accessList, accessId)) {
    return c.json({ error: "Access denied" }, 403);
  }
  return null;
};

const requireAdminUser = (c: Context) => {
  const user = c.get("currentUser") as UserRow | undefined;
  if (!user || user.role !== adminRole) {
    return c.json({ error: "Admin access required" }, 403);
  }
  return null;
};

const encoder = new TextEncoder();

const PASSWORD_HASH_PREFIX = "pbkdf2";
const PASSWORD_HASH_ITERATIONS = 100_000;

const hexToBytes = (hex: string) => {
  const cleaned = hex.trim();
  const pairs = cleaned.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => Number.parseInt(byte, 16)));
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const randomSalt = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hashPassword = async (password: string, salt: string, iterations = PASSWORD_HASH_ITERATIONS) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(salt),
      iterations
    },
    key,
    256
  );
  const hash = bytesToHex(new Uint8Array(derived));
  return `${PASSWORD_HASH_PREFIX}$${iterations}$${hash}`;
};

const hashPasswordLegacy = async (password: string, salt: string) => {
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
};

const verifyPassword = async (password: string, salt: string, hash: string) => {
  if (!hash) return false;
  if (hash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
    const [, iterPart, stored] = hash.split("$");
    const iterations = Number.parseInt(iterPart, 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const computed = await hashPassword(password, salt, iterations);
    return computed === hash;
  }
  const legacy = await hashPasswordLegacy(password, salt);
  return legacy === hash;
};

const buildUserResponse = (row: UserRow) => {
  const accessList = normalizeAccessList(row.access_list ?? row.access);
  const normalizedAccessList = accessList.length ? accessList : row.role === adminRole ? [...defaultAccessList] : [];
  return {
    id: row.id,
    email: normalizeEmail(row.email || ""),
    name: row.name || "",
    role: row.role || adminRole,
    access: row.access || "",
    accessList: normalizedAccessList,
    enabled: row.enabled !== 0
  };
};

const getUserByEmail = async (db: D1Queryable, email: string) =>
  db
    .prepare(
      "SELECT id, email, name, role, access, access_list, password_hash, password_salt, enabled FROM users WHERE email = ? LIMIT 1"
    )
    .bind(email)
    .first<UserRow>();

const countUsers = async (db: D1Queryable) => {
  const row = await db.prepare("SELECT COUNT(*) as count FROM users").bind().first<{ count: number }>();
  return row?.count ?? 0;
};

const requireUser = async (db: D1Queryable, email: string) => {
  const user = await getUserByEmail(db, email);
  if (!user || user.enabled === 0) return null;
  return user;
};

const requireAdmin = async (db: D1Queryable, email: string) => {
  const user = await requireUser(db, email);
  if (!user || user.role !== adminRole) return null;
  return user;
};

const isEmailAvailable = async (db: D1Queryable, nextEmail: string) => {
  for (const table of ownerEmailTables) {
    const existing = await db.prepare(`SELECT 1 FROM ${table} WHERE owner_email = ? LIMIT 1`).bind(nextEmail).first();
    if (existing) return false;
  }
  const user = await getUserByEmail(db, nextEmail);
  if (user) return false;
  return true;
};

const updateOwnerEmailTables = async (db: D1Database, fromEmail: string, toEmail: string) => {
  const updates = ownerEmailTables.map((table) =>
    db.prepare(`UPDATE ${table} SET owner_email = ? WHERE owner_email = ?`).bind(toEmail, fromEmail)
  );
  await batchInChunks(db, updates);
};

function normalizeCompanyName(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

async function buildCompanyLookup(db: D1Database, ownerEmail: string): Promise<Map<string, number>> {
  const { results } = await db.prepare("SELECT id, name FROM companies WHERE owner_email = ?").bind(ownerEmail).all();
  const lookup = new Map<string, number>();
  (results ?? []).forEach((row) => {
    const name = normalizeCompanyName((row as { name?: string }).name);
    const id = Number((row as { id?: number }).id);
    if (name && Number.isFinite(id)) {
      lookup.set(name, id);
    }
  });
  return lookup;
}

async function attachTags(db: D1Database, ownerEmail: string, entityType: string, entityId: number | null, tags: number[]) {
  if (!entityId || !tags.length) return;
  const inserts = tags.map((tagId) =>
    db
      .prepare("INSERT OR IGNORE INTO tag_links (tag_id, entity_type, entity_id, owner_email) VALUES (?, ?, ?, ?)")
      .bind(tagId, entityType, entityId, ownerEmail)
  );
  if (inserts.length) {
    await batchInChunks(db, inserts);
  }
}

async function getPipeline(db: D1Queryable, ownerEmail: string) {
  const [orders, invoices] = await db.batch<{ ref: string; account: string; amount: number; status: string }>([
    db
      .prepare(
        `SELECT o.reference AS ref, c.name AS account, o.total_amount AS amount, o.status
         FROM orders o
         LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = ?
         WHERE o.owner_email = ?
         ORDER BY o.updated_at DESC
         LIMIT 5`
      )
      .bind(ownerEmail, ownerEmail),
    db
      .prepare(
        `SELECT i.reference AS ref, c.name AS account, i.total_amount AS amount, i.status
         FROM invoices i
         LEFT JOIN companies c ON c.id = i.company_id AND c.owner_email = ?
         WHERE i.owner_email = ?
         ORDER BY i.updated_at DESC
         LIMIT 5`
      )
      .bind(ownerEmail, ownerEmail)
  ]);

  const parseAmount = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/[^0-9.-]+/g, "");
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const formatAmount = (amount?: number | string | null) => {
    const numeric = parseAmount(amount);
    return numeric !== null ? `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "$0";
  };

  const combined = [...(orders.results ?? []), ...(invoices.results ?? [])]
    .slice(0, 6)
    .map((entry) => ({
      ref: entry.ref,
            account: entry.account ?? "Unknown",
      amount: formatAmount(entry.amount),
      status: entry.status ?? "Open",
      statusType: statusTone(entry.status ?? "Open")
    }));

  if (!combined.length) {
    return [];
  }

  return combined;
}

async function getActivity(db: D1Queryable, ownerEmail: string) {
  const notes = await db
    .prepare(
      `SELECT body, author, entity_type
       FROM notes
       WHERE owner_email = ?
       ORDER BY updated_at DESC
       LIMIT 6`
    )
    .bind(ownerEmail)
    .all<{ body: string; author: string; entity_type: string }>();

  if (!notes.results || !notes.results.length) {
    return [];
  }

  return notes.results.map((note) => ({
    title: note.body,
    tag: note.entity_type,
    color: "#2563eb",
    author: note.author
  }));
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("overdue") || normalized.includes("pending")) return "warning";
  if (normalized.includes("completed") || normalized.includes("paid") || normalized.includes("on track")) return "success";
  return "info";
}

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const needsQuote = str.includes(",") || str.includes("\"") || str.includes("\n");
  return needsQuote ? `"${str.replace(/"/g, '""')}"` : str;
}

function generateRef(prefix: string) {
  const stamp = Date.now().toString().slice(-6);
  return `${prefix}-${stamp}`;
}

async function hasColumn(db: D1Database, table: string, column: string) {
  const { results } = await db
    .prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ? LIMIT 1`)
    .bind(column)
    .all<{ 1: number }>();
  return Boolean(results && results.length);
}

async function serveAsset(c: Context<{ Bindings: Env; Variables: { ownerEmail: string; currentUser: UserRow; accessList: string[]; } }>) {
  const url = new URL(c.req.url);
  const rawPath = url.pathname;
  const isAnalytics = rawPath.startsWith("/analytics");
  let path = rawPath === "/" ? "/index.html" : rawPath;
  if (isAnalytics && (rawPath === "/analytics" || rawPath === "/analytics/")) {
    path = "/analytics/index.html";
  }

  const assetRequest = new Request(new URL(path, url.origin).toString(), {
    method: "GET",
    headers: c.req.raw.headers
  });

  const assetResponse = await c.env.ASSETS.fetch(assetRequest);
  if (assetResponse.status === 404) {
    if (isAnalytics) {
      const analyticsFallback = new Request(new URL("/analytics/index.html", url.origin).toString(), {
        method: "GET",
        headers: c.req.raw.headers
      });
      return c.env.ASSETS.fetch(analyticsFallback);
    }
    if (path !== "/index.html") {
      const fallbackRequest = new Request(new URL("/index.html", url.origin).toString(), {
        method: "GET",
        headers: c.req.raw.headers
      });
      return c.env.ASSETS.fetch(fallbackRequest);
    }
  }

  return assetResponse;
}
