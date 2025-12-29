import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";

type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  CACHE: KVNamespace;
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

const cacheableTables = new Set<string>([
  "companies",
  "contacts",
  "products",
  "quotations",
  "documents",
  "sample_shipments",
  "tasks",
  "notes",
  "tags",
  "doc_types",
  "quotation_items"
]);

const CACHE_TTL_SECONDS = 60;
const TAGGED_LIST_TABLES = ["orders", "quotations", "documents"];
const DOC_TYPE_LIST_TABLES = ["doc_types", "documents"];
const CACHEABLE_TABLES_LIST = Array.from(cacheableTables.values());
const adminRole = "Admin";
const salesRole = "Salesperson";
const defaultAccessList = [
  "tags",
  "companies",
  "contacts",
  "products",
  "pricing",
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

const updatableFields: Record<string, string[]> = {
  companies: ["name", "website", "email", "phone", "owner", "industry", "status", "address", "updated_at", "company_code"],
  contacts: ["company_id", "first_name", "last_name", "email", "phone", "role", "status"],
  products: ["name", "sku", "category", "price", "currency", "status", "description"],
  orders: ["company_id", "contact_id", "quotation_id", "invoice_ids", "status", "total_amount", "currency", "reference"],
  quotations: ["company_id", "contact_id", "reference", "amount", "currency", "status", "valid_until", "title", "tax_rate", "notes", "bank_charge_method", "attachment_key"],
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
    "tracking_number",
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
    "tracking_number",
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
  doc_types: ["id", "owner_email", "name", "created_at"],
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

const selectColumns = (alias: string, columns: string[]) => columns.map((col) => `${alias}.${col}`).join(", ");

const parseFilters = (table: string, searchParams: URLSearchParams) => {
  const allowed = filterableFields[table] ?? [];
  return allowed
    .map((field) => {
      const raw = searchParams.get(field);
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      if (field.endsWith("_id") || field === "related_id" || field === "entity_id") {
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) return null;
        return { column: field, value: numeric };
      }
      return { column: field, value: trimmed };
    })
    .filter((entry): entry is { column: string; value: string | number } => entry !== null);
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
};

const normalizeConfigText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

async function getSiteConfig(db: D1Database, ownerEmail: string) {
  const row = await db
    .prepare(
      `SELECT site_name, base_company, region, timezone, theme, active_theme,
              invoice_name, invoice_address, invoice_phone, show_footer
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
    }>();

  if (!row) return null;
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
    showFooter: row.show_footer === null ? undefined : row.show_footer === 1
  };
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
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      showFooter ? 1 : 0
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
    showFooter
  };
}

const runBatches = async (db: D1Database, statements: D1PreparedStatement[], batchSize = 50) => {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length) {
      await db.batch(chunk);
    }
  }
};

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
    tracking_number TEXT,
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

const app = new Hono<{ Bindings: Env; Variables: { ownerEmail: string } }>();

app.use("/api/*", cors());

app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env.DB);
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health" || path === "/api/auth/login") {
    await next();
    return;
  }
  const ownerEmail = (c.req.header("x-user-email") || "").trim().toLowerCase();
  if (!ownerEmail) {
    return c.json({ error: "Missing user context" }, 401);
  }
  c.set("ownerEmail", ownerEmail);
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString()
  })
);

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; name?: string; accessList?: string[]; access?: string }>().catch(() => ({}));
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
      return c.json({ ok: true, bootstrap: true, user: buildUserResponse(user) });
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
  return c.json({ ok: true, user: buildUserResponse(user) });
});

app.get("/api/auth/users", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  if (!(await requireAdmin(c.env.DB, ownerEmail))) {
    return c.json({ error: "Admin access required" }, 403);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, access, access_list, enabled FROM users ORDER BY role = 'Admin' DESC, name, email"
  ).all<UserRow>();
  const users = (results ?? []).map((row) => buildUserResponse(row));
  return c.json({ users });
});

app.post("/api/auth/users", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  if (!(await requireAdmin(c.env.DB, ownerEmail))) {
    return c.json({ error: "Admin access required" }, 403);
  }
  const body = await c.req.json<{
    name?: string;
    email?: string;
    role?: string;
    accessList?: string[];
    access?: string;
    password?: string;
  }>().catch(() => ({}));
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
  const ownerEmail = c.get("ownerEmail");
  if (!(await requireAdmin(c.env.DB, ownerEmail))) {
    return c.json({ error: "Admin access required" }, 403);
  }
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user id" }, 400);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
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
  const ownerEmail = c.get("ownerEmail");
  if (!(await requireAdmin(c.env.DB, ownerEmail))) {
    return c.json({ error: "Admin access required" }, 403);
  }
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid user id" }, 400);
  }
  const body = await c.req.json<{ password?: string }>().catch(() => ({}));
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
  const ownerEmail = c.get("ownerEmail");
  if (!(await requireAdmin(c.env.DB, ownerEmail))) {
    return c.json({ error: "Admin access required" }, 403);
  }
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
  const body = await c.req.json<{
    currentPassword?: string;
    newPassword?: string;
    newEmail?: string;
  }>().catch(() => ({}));
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
  const ownerEmail = c.get("ownerEmail");
  const config = await getSiteConfig(c.env.DB, ownerEmail);
  return c.json({ config: config ?? {} });
});

app.put("/api/settings/site-config", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const payload = await c.req.json<SiteConfigPayload>().catch(() => ({}));
  const config = await upsertSiteConfig(c.env.DB, ownerEmail, payload);
  return c.json({ ok: true, config });
});

app.get("/api/dashboard", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  await syncShippingMilestones(c.env.DB, ownerEmail);
  const stats = await getStats(c.env.DB, ownerEmail);
  const pipeline = await getPipeline(c.env.DB, ownerEmail);
  const activity = await getActivity(c.env.DB, ownerEmail);

  return c.json({ stats, pipeline, activity });
});

app.get("/api/:table", async (c) => {
  const table = c.req.param("table");
  if (!allowedTables.includes(table)) {
    return c.json({ error: "Unknown table" }, 404);
  }
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
  if (table === "orders" || table === "invoices" || table === "shipping_schedules") {
    await syncShippingMilestones(c.env.DB, ownerEmail);
  }

  if (!cacheBypass && cacheableTables.has(table)) {
    const filterKey = buildFilterKey(filters);
    const version = (await c.env.CACHE.get(cacheVersionKey(ownerEmail, table))) ?? "0";
    const cacheKey = new Request(buildCacheKey(ownerEmail, table, filterKey, version, limit, offset));
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return cached;
    }
    const rows = await fetchRows(c.env.DB, table, ownerEmail, filters, limit, offset);
    const body = JSON.stringify({ rows });
    const response = new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `max-age=${CACHE_TTL_SECONDS}`
      }
    });
    await caches.default.put(cacheKey, response.clone());
    return response;
  }

  const rows = await fetchRows(c.env.DB, table, ownerEmail, filters, limit, offset);
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

  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<Record<string, unknown>>();
  if (table === "orders") {
    const invoiceIds = normalizeInvoiceIds((body as any).invoice_ids ?? (body as any).invoice_links);
    if (invoiceIds !== null) {
      (body as any).invoice_ids = invoiceIds;
    }
  }
  const tags = normalizeTags((body as any).tags);
  const entries = Object.entries(body).filter(([key]) => updatableFields[table].includes(key));

  if (!entries.length && !tags.length) {
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

  if (table === "shipping_schedules") {
    await syncShippingMilestones(c.env.DB, ownerEmail);
  }

  if (changes || tags.length) {
    await bumpCacheVersion(c.env, ownerEmail, table);
  }
  return c.json({ ok: true, changes });
});

app.delete("/api/:table/:id", async (c) => {
  const table = c.req.param("table");
  const id = Number(c.req.param("id"));
  if (!updatableFields[table] || Number.isNaN(id)) {
    return c.json({ error: "Invalid table or id" }, 400);
  }

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
      await runBatches(c.env.DB, detach);
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
      await runBatches(c.env.DB, detach);
    }
  }

  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND owner_email = ?`).bind(id, ownerEmail).run();
  await bumpCacheVersion(c.env, ownerEmail, table);
  return c.json({ ok: true });
});

app.post("/api/contacts", async (c) => {
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
      const code = typeof company.company_code === "string" ? company.company_code.trim() : null;
      const industry = typeof company.industry === "string" ? company.industry.trim() : null;
      return c.env.DB.prepare(
        `INSERT INTO companies (name, company_code, website, email, phone, owner, industry, status, address, owner_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        name,
        code ?? null,
        company.website ?? null,
        company.email ?? null,
        company.phone ?? null,
        company.owner ?? null,
        industry ?? null,
        company.status ?? "Active",
        company.address ?? null,
        ownerEmail
      );
    });

    await runBatches(c.env.DB, inserts);
    await bumpCacheVersion(c.env, ownerEmail, "companies");
    return c.json({ inserted: inserts.length });
  } catch (err) {
    console.error("Bulk company insert failed", err);
    const message = err instanceof Error ? err.message : "Could not import companies";
    return c.json({ error: message }, 400);
  }
});

app.get("/api/companies/csv", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const { results } = await c.env.DB.prepare(
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

  const tags = normalizeTags(body.tags);
  const result = await c.env.DB.prepare(
    `INSERT INTO products (name, sku, category, price, currency, status, description, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.name,
      body.sku ?? null,
      body.category ?? null,
      body.price ?? 0,
      body.currency ?? "USD",
      body.status ?? "Active",
      body.description ?? null,
      ownerEmail
    )
    .run();

  const id = result.meta.last_row_id;
  await attachTags(c.env.DB, ownerEmail, "product", id, tags);

  return c.json({ id });
});

app.post("/api/contacts/bulk", async (c) => {
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

  let companyLookup: Map<string, number> | null = null;
  if (body.some((contact) => !contact.company_id && contact.company_name)) {
    companyLookup = await buildCompanyLookup(c.env.DB, ownerEmail);
  }

  const inserts = body.map((contact) => {
    const normalizedName = contact.company_name ? normalizeCompanyName(contact.company_name) : "";
    const resolvedCompanyId =
      contact.company_id ??
      (normalizedName && companyLookup ? companyLookup.get(normalizedName) : null) ??
      null;
    return c.env.DB
      .prepare(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, role, status, owner_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        resolvedCompanyId,
        contact.first_name,
        contact.last_name,
        contact.email ?? null,
        contact.phone ?? null,
        contact.role ?? null,
        contact.status ?? "Engaged",
        ownerEmail
      );
  });

  await runBatches(c.env.DB, inserts);
  await bumpCacheVersion(c.env, ownerEmail, "contacts");
  return c.json({ inserted: inserts.length });
});

app.get("/api/contacts/csv", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const { results } = await c.env.DB.prepare(
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

  const inserts = body
    .filter((p) => typeof p.name === "string" && p.name.trim())
    .map((p) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO products (name, sku, category, price, currency, status, description, owner_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.name.trim(),
        p.sku ?? null,
        p.category ?? null,
        p.price ?? 0,
        p.currency ?? "USD",
        p.status ?? "Active",
        p.description ?? null,
        ownerEmail
      )
    );

  await runBatches(c.env.DB, inserts);
  await bumpCacheVersion(c.env, ownerEmail, "products");
  return c.json({ inserted: inserts.length });
});

app.get("/api/products/csv", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const { results } = await c.env.DB.prepare(
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
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    contact_id?: number;
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    valid_until?: string;
    title?: string;
    tax_rate?: number;
    notes?: string;
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
  const result = await c.env.DB.prepare(
    `INSERT INTO quotations (company_id, contact_id, reference, amount, currency, status, valid_until, title, tax_rate, notes, bank_charge_method, attachment_key, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.company_id ?? null,
      body.contact_id ?? null,
      ref,
      body.amount ?? 0,
      body.currency ?? "USD",
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
    await runBatches(c.env.DB, inserts);
  }

  await attachTags(c.env.DB, ownerEmail, "quotation", quotationId, tags);

  return c.json({ id: quotationId, reference: ref });
});

app.post("/api/invoices", async (c) => {
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
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    order_id?: number;
    invoice_id?: number;
    company_id?: number;
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
  const result = await c.env.DB.prepare(
    `INSERT INTO shipping_schedules (order_id, invoice_id, company_id, carrier, tracking_number, factory_exit_date, etc_date, etd_date, eta, status, notes, owner_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.order_id ?? null,
      body.invoice_id ?? null,
      body.company_id ?? null,
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
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{
    company_id?: number;
    product_id?: number;
    document_id?: number;
    receiving_address?: string;
    phone?: string;
    quantity?: number;
    tracking_number?: string;
    waybill_number?: string;
    courier?: string;
    status?: string;
    notes?: string;
  }>();

  const result = await c.env.DB
    .prepare(
      `INSERT INTO sample_shipments (company_id, product_id, document_id, receiving_address, phone, quantity, tracking_number, waybill_number, courier, status, notes, owner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body.company_id ?? null,
      body.product_id ?? null,
      body.document_id ?? null,
      body.receiving_address ?? null,
      body.phone ?? null,
      body.quantity ?? 0,
      body.tracking_number ?? null,
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
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{ name: string; color?: string }>();
  const result = await c.env.DB.prepare(`INSERT INTO tags (name, color, owner_email) VALUES (?, ?, ?)`)
    .bind(body.name, body.color ?? "#2563eb", ownerEmail)
    .run();

  await bumpCacheVersions(c.env, ownerEmail, ["tags", ...TAGGED_LIST_TABLES]);
  return c.json({ id: result.meta.last_row_id });
});

app.delete("/api/tags/:id", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM tags WHERE id = ? AND owner_email = ?").bind(id, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, ["tags", ...TAGGED_LIST_TABLES]);
  return c.json({ ok: true });
});

app.post("/api/doc_types", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const body = await c.req.json<{ name: string }>();
  if (!body.name) return c.json({ error: "name is required" }, 400);
  const result = await c.env.DB.prepare(`INSERT INTO doc_types (name, owner_email) VALUES (?, ?)`).bind(body.name, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, DOC_TYPE_LIST_TABLES);
  return c.json({ id: result.meta.last_row_id });
});

app.delete("/api/doc_types/:id", async (c) => {
  const ownerEmail = c.get("ownerEmail");
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM doc_types WHERE id = ? AND owner_email = ?").bind(id, ownerEmail).run();
  await bumpCacheVersions(c.env, ownerEmail, DOC_TYPE_LIST_TABLES);
  return c.json({ ok: true });
});

app.post("/api/documents", async (c) => {
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
  const keyParam = c.req.param("key");
  const key = decodeURIComponent(keyParam || "");
  if (!key) {
    return c.text("Missing file key", 400);
  }
  
  console.log(`R2 Upload attempt for key="${key}" Content-Length="${c.req.header("content-length")}" Content-Type="${c.req.header("content-type")}"`);
  
  let body: ArrayBuffer | null = null;
  try {
    body = await c.req.arrayBuffer();
    console.log(`R2 body received length: ${body.byteLength}`);
  } catch (err) {
    console.error("Failed to read upload body", err);
    return c.text("Invalid file body", 400);
  }

  if (!body || !body.byteLength) {
    return c.text("Missing file body", 400);
  }

  const contentType = c.req.header("content-type") || "application/octet-stream";
  await c.env.FILES.put(key, body, { httpMetadata: { contentType } });

  return c.json({ key });
});

app.post("/api/upload", async (c) => {
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

    console.log(`R2 Upload via multipart: key="${key}" size=${file.size} type="${file.type}"`);

    const body = await file.arrayBuffer();
    console.log(`R2 body length from file.arrayBuffer(): ${body.byteLength}`);

    if (body.byteLength === 0) {
      console.error("Empty body from file.arrayBuffer()");
      continue;
    }

    const contentType = file.type || 'application/octet-stream';
    await c.env.FILES.put(key, body, { httpMetadata: { contentType } });
    console.log(`R2 put success for ${key}`);

    const stmt = c.env.DB.prepare(`
      INSERT INTO documents (company_id, contact_id, invoice_id, doc_type_id, title, storage_key, content_type, size, owner_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, title, storage_key as key
    `).bind(companyId, contactId, invoiceId, docTypeId, title, key, contentType, body.byteLength, ownerEmail);

    const doc = await stmt.first();
    console.log(`Document inserted: id=${doc?.id}`);

    if (doc && tags.length) {
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
  const ownerEmail = c.get("ownerEmail");
  const keyParam = c.req.param("key");
  const key = decodeURIComponent(keyParam || "");
  if (!key) {
    return c.notFound();
  }

  const record = await c.env.DB
    .prepare("SELECT id FROM documents WHERE storage_key = ? AND owner_email = ?")
    .bind(key, ownerEmail)
    .first();
  if (!record) {
    return c.notFound();
  }

  const object = await c.env.FILES.get(key);

  if (!object) {
    return c.notFound();
  }

  const filename = key.split("/").pop() || "file";

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`
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
  const indexes = await db.prepare(`PRAGMA index_list(${table})`).all<{ name: string; unique: number }>();
  for (const idx of indexes.results ?? []) {
    if (!idx.unique || !idx.name) continue;
    const info = await db.prepare(`PRAGMA index_info(${idx.name})`).all<{ name: string }>();
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
  const columnsInfo = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
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

  await db.prepare(`DROP TABLE IF EXISTS ${table}_new`).run();
  await db.prepare("PRAGMA foreign_keys = OFF").run();
  await db.prepare(createSql).run();
  await db.prepare(`INSERT INTO ${table}_new (${quotedColumns}) SELECT ${selectColumns} FROM ${table}`).run();
  await db.prepare(`DROP TABLE ${table}`).run();
  await db.prepare(`ALTER TABLE ${table}_new RENAME TO ${table}`).run();
  await db.prepare("PRAGMA foreign_keys = ON").run();
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
    const hasTable = await db.prepare(`PRAGMA table_info(${target.table})`).all<{ name: string }>();
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
    await db.batch(schemaIndexStatements.map((sql) => db.prepare(sql)));
  }
}

async function ensureSchema(db: D1Database) {
  if (schemaInitialized) return;
  await db.batch(schemaStatements.map((sql) => db.prepare(sql)));

  // Backfill note_date if missing on existing databases
  const noteColumns = await db.prepare("PRAGMA table_info(notes)").all<{ name: string }>();
  const hasNoteDate = noteColumns.results?.some((c) => c.name === "note_date");
  if (!hasNoteDate) {
    await db.prepare("ALTER TABLE notes ADD COLUMN note_date TEXT").run();
  }

  const companyColumns = await db.prepare("PRAGMA table_info(companies)").all<{ name: string }>();
  const companyNames = new Set(companyColumns.results?.map((c) => c.name));
  if (companyNames.size && !companyNames.has("company_code")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN company_code TEXT").run();
  }
  if (companyNames.size && !companyNames.has("address")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN address TEXT").run();
  }
  if (companyNames.size && !companyNames.has("industry")) {
    await db.prepare("ALTER TABLE companies ADD COLUMN industry TEXT").run();
  }

  const shipColumns = await db.prepare("PRAGMA table_info(shipping_schedules)").all<{ name: string }>();
  const shipNames = new Set(shipColumns.results?.map((c) => c.name));
  if (shipNames.size) {
    if (!shipNames.has("invoice_id")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN invoice_id INTEGER").run();
    if (!shipNames.has("company_id")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN company_id INTEGER").run();
    if (!shipNames.has("factory_exit_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN factory_exit_date TEXT").run();
    if (!shipNames.has("etc_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN etc_date TEXT").run();
    if (!shipNames.has("etd_date")) await db.prepare("ALTER TABLE shipping_schedules ADD COLUMN etd_date TEXT").run();
  }

  const sampleColumns = await db.prepare("PRAGMA table_info(sample_shipments)").all<{ name: string }>();
  const sampleNames = new Set(sampleColumns.results?.map((c) => c.name));
  if (sampleNames.size) {
    if (!sampleNames.has("document_id")) await db.prepare("ALTER TABLE sample_shipments ADD COLUMN document_id INTEGER").run();
    if (!sampleNames.has("tracking_number")) await db.prepare("ALTER TABLE sample_shipments ADD COLUMN tracking_number TEXT").run();
  }

  const docColumns = await db.prepare("PRAGMA table_info(documents)").all<{ name: string }>();
  const docNames = new Set(docColumns.results?.map((c) => c.name));
  if (docNames.size) {
    if (!docNames.has("invoice_id")) await db.prepare("ALTER TABLE documents ADD COLUMN invoice_id INTEGER").run();
    if (!docNames.has("doc_type_id")) await db.prepare("ALTER TABLE documents ADD COLUMN doc_type_id INTEGER").run();
  }

  const orderColumns = await db.prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  const orderNames = new Set(orderColumns.results?.map((c) => c.name));
  if (orderNames.size && !orderNames.has("quotation_id")) {
    await db.prepare("ALTER TABLE orders ADD COLUMN quotation_id INTEGER").run();
  }
  if (orderNames.size && !orderNames.has("invoice_ids")) {
    await db.prepare("ALTER TABLE orders ADD COLUMN invoice_ids TEXT").run();
  }

  const quoteColumns = await db.prepare("PRAGMA table_info(quotations)").all<{ name: string }>();
  const quoteNames = new Set(quoteColumns.results?.map((c) => c.name));
  if (quoteNames.size) {
    if (!quoteNames.has("title")) await db.prepare("ALTER TABLE quotations ADD COLUMN title TEXT").run();
    if (!quoteNames.has("tax_rate")) await db.prepare("ALTER TABLE quotations ADD COLUMN tax_rate REAL DEFAULT 0").run();
    if (!quoteNames.has("notes")) await db.prepare("ALTER TABLE quotations ADD COLUMN notes TEXT").run();
    if (!quoteNames.has("bank_charge_method")) await db.prepare("ALTER TABLE quotations ADD COLUMN bank_charge_method TEXT").run();
    if (!quoteNames.has("attachment_key")) await db.prepare("ALTER TABLE quotations ADD COLUMN attachment_key TEXT").run();
  }

  const invoiceColumns = await db.prepare("PRAGMA table_info(invoices)").all<{ name: string }>();
  const invoiceNames = new Set(invoiceColumns.results?.map((c) => c.name));
  if (invoiceNames.size) {
    if (!invoiceNames.has("attachment_key")) await db.prepare("ALTER TABLE invoices ADD COLUMN attachment_key TEXT").run();
  }

  for (const table of ownerEmailTables) {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const names = new Set(columns.results?.map((c) => c.name));
    if (names.size && !names.has("owner_email")) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN owner_email TEXT`).run();
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
      await updateSchedule.bind(computedStatus, row.id, ownerEmail, computedStatus).run();
    }
    if (row.order_id) applyStatus(orderStatuses, row.order_id, computedStatus);
    if (row.invoice_id) applyStatus(invoiceStatuses, row.invoice_id, computedStatus);
  }

  if (orderStatuses.size) {
    const updateOrder = db.prepare(
      `UPDATE orders
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)`
    );
    for (const [id, status] of orderStatuses.entries()) {
      await updateOrder.bind(status, id, ownerEmail, status).run();
    }
  }

  if (invoiceStatuses.size) {
    const updateInvoice = db.prepare(
      `UPDATE invoices
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)`
    );
    for (const [id, status] of invoiceStatuses.entries()) {
      await updateInvoice.bind(status, id, ownerEmail, status).run();
    }
  }
}

async function getStats(db: D1Database, ownerEmail: string) {
  const result: Record<string, number> = {};

  for (const table of ["companies", "contacts", "orders", "quotations", "invoices", "tasks"]) {
    const row = await db
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE owner_email = ?`)
      .bind(ownerEmail)
      .first<{ count: number }>();
    result[table === "orders" ? "openOrders" : table] = row?.count ?? 0;
  }

  return result;
}

async function fetchRows(
  db: D1Database,
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

const encoder = new TextEncoder();

const randomSalt = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const hashPassword = async (password: string, salt: string) => {
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const verifyPassword = async (password: string, salt: string, hash: string) =>
  hashPassword(password, salt).then((computed) => computed === hash);

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

const getUserByEmail = async (db: D1Database, email: string) =>
  db
    .prepare(
      "SELECT id, email, name, role, access, access_list, password_hash, password_salt, enabled FROM users WHERE email = ? LIMIT 1"
    )
    .bind(email)
    .first<UserRow>();

const countUsers = async (db: D1Database) => {
  const row = await db.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
  return row?.count ?? 0;
};

const requireUser = async (db: D1Database, email: string) => {
  const user = await getUserByEmail(db, email);
  if (!user || user.enabled === 0) return null;
  return user;
};

const requireAdmin = async (db: D1Database, email: string) => {
  const user = await requireUser(db, email);
  if (!user || user.role !== adminRole) return null;
  return user;
};

const isEmailAvailable = async (db: D1Database, nextEmail: string) => {
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
  await runBatches(db, updates);
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
    await runBatches(db, inserts);
  }
}

async function getPipeline(db: D1Database, ownerEmail: string) {
  const orders = await db
    .prepare(
      `SELECT o.reference AS ref, c.name AS account, o.total_amount AS amount, o.status
       FROM orders o
       LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = ?
       WHERE o.owner_email = ?
       ORDER BY o.updated_at DESC
       LIMIT 5`
    )
    .bind(ownerEmail, ownerEmail)
    .all<{ ref: string; account: string; amount: number; status: string }>();

  const invoices = await db
    .prepare(
      `SELECT i.reference AS ref, c.name AS account, i.total_amount AS amount, i.status
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id AND c.owner_email = ?
       WHERE i.owner_email = ?
       ORDER BY i.updated_at DESC
       LIMIT 5`
    )
    .bind(ownerEmail, ownerEmail)
    .all<{ ref: string; account: string; amount: number; status: string }>();

  const formatAmount = (amount?: number) =>
    typeof amount === "number" && !Number.isNaN(amount)
      ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : "$0";

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

async function getActivity(db: D1Database, ownerEmail: string) {
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

async function serveAsset(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;

  const assetRequest = new Request(new URL(path, url.origin).toString(), {
    method: "GET",
    headers: c.req.raw.headers
  });

  const assetResponse = await c.env.ASSETS.fetch(assetRequest);
  if (assetResponse.status === 404 && path !== "/index.html") {
    const fallbackRequest = new Request(new URL("/index.html", url.origin).toString(), {
      method: "GET",
      headers: c.req.raw.headers
    });
    return c.env.ASSETS.fetch(fallbackRequest);
  }

  return assetResponse;
}
