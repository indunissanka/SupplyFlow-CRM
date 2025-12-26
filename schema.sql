-- D1 schema for CRM

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
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
);

CREATE TABLE IF NOT EXISTS contacts (
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
);

CREATE TABLE IF NOT EXISTS products (
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
);

CREATE TABLE IF NOT EXISTS orders (
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
);

CREATE TABLE IF NOT EXISTS quotations (
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
);

CREATE TABLE IF NOT EXISTS invoices (
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
);

CREATE TABLE IF NOT EXISTS documents (
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
);

CREATE TABLE IF NOT EXISTS shipping_schedules (
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
);

CREATE TABLE IF NOT EXISTS sample_shipments (
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
);

CREATE TABLE IF NOT EXISTS tasks (
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
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  body TEXT NOT NULL,
  author TEXT,
  note_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#2563eb',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tag_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tag_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS quotation_items (
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
);

CREATE TABLE IF NOT EXISTS doc_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_quotation ON orders(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_quotations_contact ON quotations(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_docs_contact ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_docs_invoice ON documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_docs_doc_type ON documents(doc_type_id);
CREATE INDEX IF NOT EXISTS idx_shipping_order ON shipping_schedules(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_invoice ON shipping_schedules(invoice_id);
CREATE INDEX IF NOT EXISTS idx_shipping_company ON shipping_schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_sample_shipments_company ON sample_shipments(company_id);
CREATE INDEX IF NOT EXISTS idx_sample_shipments_product ON sample_shipments(product_id);
CREATE INDEX IF NOT EXISTS idx_sample_shipments_document ON sample_shipments(document_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_product ON quotation_items(product_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_companies_owner_updated ON companies(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_updated ON contacts(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_owner_updated ON orders(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_quotations_owner_updated ON quotations(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_invoices_owner_updated ON invoices(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_shipping_owner_updated ON shipping_schedules(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_sample_shipments_owner_updated ON sample_shipments(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated ON tasks(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes(owner_email, updated_at);
CREATE INDEX IF NOT EXISTS idx_tags_owner_created ON tags(owner_email, created_at);
CREATE INDEX IF NOT EXISTS idx_doc_types_owner_created ON doc_types(owner_email, created_at);
CREATE INDEX IF NOT EXISTS idx_quotation_items_owner_created ON quotation_items(owner_email, created_at);
CREATE INDEX IF NOT EXISTS idx_companies_owner_name ON companies(owner_email, name);
CREATE INDEX IF NOT EXISTS idx_products_owner_name ON products(owner_email, name);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_last_first ON contacts(owner_email, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_tag_links_owner_entity ON tag_links(owner_email, entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_owner ON companies(name, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_code_owner ON companies(company_code, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email_owner ON contacts(email, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_owner ON products(sku, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference_owner ON orders(reference, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_reference_owner ON quotations(reference, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_reference_owner ON invoices(reference, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_owner ON tags(name, owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_types_name_owner ON doc_types(name, owner_email);
