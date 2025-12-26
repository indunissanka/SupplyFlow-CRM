import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError
import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / "public"
SCHEMA_PATH = BASE_DIR / "schema.sql"

ALLOWED_TABLES = [
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
]

OWNER_EMAIL_TABLES = [
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
]

UPDATABLE_FIELDS: Dict[str, List[str]] = {
    "companies": ["name", "website", "email", "phone", "owner", "industry", "status", "address", "updated_at", "company_code"],
    "contacts": ["company_id", "first_name", "last_name", "email", "phone", "role", "status"],
    "products": ["name", "sku", "category", "price", "currency", "status", "description"],
    "orders": ["company_id", "contact_id", "quotation_id", "invoice_ids", "status", "total_amount", "currency", "reference"],
    "quotations": [
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
    ],
    "invoices": ["company_id", "contact_id", "reference", "total_amount", "currency", "due_date", "status", "attachment_key"],
    "documents": ["company_id", "contact_id", "invoice_id", "doc_type_id", "title", "content_type", "size"],
    "shipping_schedules": [
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
    ],
    "sample_shipments": [
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
    ],
    "tasks": ["title", "status", "due_date", "assignee", "related_type", "related_id"],
    "notes": ["entity_type", "entity_id", "body", "author", "note_date"],
    "tags": ["name", "color"],
    "doc_types": ["name"],
}

ENTITY_TYPES: Dict[str, str] = {
    "companies": "company",
    "contacts": "contact",
    "products": "product",
    "orders": "order",
    "quotations": "quotation",
    "invoices": "invoice",
    "documents": "document",
    "shipping_schedules": "shipping",
    "sample_shipments": "sample_shipment",
    "tasks": "task",
    "notes": "note",
}

SHIPPING_STATUS_RANK = {
    "Factory exit": 1,
    "Dispatched": 2,
    "Cut Off": 3,
    "Shipped": 4,
    "Delivered": 5,
}

EXTRA_SCHEMA = [
    """
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
)
    """.strip()
]


class D1Client:
    def __init__(self, account_id: str, database_id: str, api_token: str) -> None:
        self.account_id = account_id
        self.database_id = database_id
        self.api_token = api_token
        self.base_url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
        )
        self.client = httpx.AsyncClient(timeout=30)

    async def close(self) -> None:
        await self.client.aclose()

    async def query(self, sql: str, params: Optional[List[Any]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        payload = {"sql": sql, "params": params or []}
        headers = {"Authorization": f"Bearer {self.api_token}"}
        resp = await self.client.post(self.base_url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(data.get("errors") or "D1 query failed")
        result_list = data.get("result") or []
        if not result_list:
            return [], {}
        result = result_list[0]
        return result.get("results") or [], result.get("meta") or {}

    async def first(self, sql: str, params: Optional[List[Any]] = None) -> Optional[Dict[str, Any]]:
        rows, _ = await self.query(sql, params)
        return rows[0] if rows else None

    async def execute(self, sql: str, params: Optional[List[Any]] = None) -> Dict[str, Any]:
        _, meta = await self.query(sql, params)
        return meta

    async def batch(self, statements: List[Tuple[str, List[Any]]]) -> None:
        for sql, params in statements:
            await self.execute(sql, params)


class R2Client:
    def __init__(self, account_id: str, access_key_id: str, secret_access_key: str, bucket: str) -> None:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            endpoint_url=endpoint,
            region_name="auto",
        )

    def put(self, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=content_type)

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code")
            if code in {"NoSuchKey", "404"}:
                return None
            raise


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)

schema_initialized = False


def parse_schema_statements(raw_sql: str) -> List[str]:
    statements: List[str] = []
    buffer: List[str] = []
    for line in raw_sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buffer.append(stripped)
        if stripped.endswith(";"):
            statement = " ".join(buffer).rstrip(";")
            statements.append(statement)
            buffer = []
    if buffer:
        statements.append(" ".join(buffer))
    return statements


async def ensure_schema(d1: D1Client) -> None:
    global schema_initialized
    if schema_initialized:
        return
    if SCHEMA_PATH.exists():
        raw = SCHEMA_PATH.read_text(encoding="utf-8")
        statements = parse_schema_statements(raw)
    else:
        statements = []
    for extra in EXTRA_SCHEMA:
        statements.append(extra)
    for statement in statements:
        await d1.execute(statement)
    company_cols, _ = await d1.query("PRAGMA table_info(companies)")
    company_names = {row.get("name") for row in company_cols if row.get("name")}
    if company_names and "industry" not in company_names:
        await d1.execute("ALTER TABLE companies ADD COLUMN industry TEXT")
    schema_initialized = True


def require_owner_email(request: Request) -> str:
    owner_email = (request.headers.get("x-user-email") or "").strip().lower()
    if not owner_email:
        raise HTTPException(status_code=401, detail="Missing user context")
    return owner_email


def normalize_tags(raw: Any) -> List[int]:
    if not isinstance(raw, list):
        return []
    tags = []
    for value in raw:
        try:
            num = int(value)
        except (TypeError, ValueError):
            continue
        if num > 0:
            tags.append(num)
    return tags


def normalize_invoice_ids(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    if isinstance(raw, list):
        items = [str(value).strip() for value in raw if str(value).strip()]
        return ",".join(items) if items else None
    if isinstance(raw, str):
        trimmed = raw.strip()
        if not trimmed:
            return None
        if trimmed.startswith("[") and trimmed.endswith("]"):
            try:
                import json
                parsed = json.loads(trimmed)
                if isinstance(parsed, list):
                    items = [str(value).strip() for value in parsed if str(value).strip()]
                    return ",".join(items) if items else None
            except Exception:
                return trimmed
        return trimmed
    text = str(raw).strip()
    return text or None


def escape_csv(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    if any(ch in text for ch in [",", "\"", "\n"]):
        return '"' + text.replace('"', '""') + '"'
    return text


async def has_column(d1: D1Client, table: str, column: str) -> bool:
    rows, _ = await d1.query(f"PRAGMA table_info({table})")
    return any(row.get("name") == column for row in rows)


def generate_ref(prefix: str) -> str:
    stamp = str(int(datetime.utcnow().timestamp() * 1000))[-6:]
    return f"{prefix}-{stamp}"


def status_tone(status: Optional[str]) -> str:
    normalized = (status or "").lower()
    if "overdue" in normalized or "pending" in normalized:
        return "warning"
    if "completed" in normalized or "paid" in normalized or "on track" in normalized:
        return "success"
    return "info"


def parse_date_ms(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def compute_shipping_milestone_status(row: Dict[str, Any], now_ms: int) -> Optional[str]:
    eta_ms = parse_date_ms(row.get("eta"))
    if eta_ms is not None and eta_ms <= now_ms:
        return "Delivered"
    etd_ms = parse_date_ms(row.get("etd_date"))
    if etd_ms is not None and etd_ms <= now_ms:
        return "Shipped"
    etc_ms = parse_date_ms(row.get("etc_date"))
    if etc_ms is not None and etc_ms <= now_ms:
        return "Cut Off"
    factory_ms = parse_date_ms(row.get("factory_exit_date"))
    if factory_ms is not None and factory_ms <= now_ms:
        return "Dispatched"
    return None


def get_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


async def get_d1() -> D1Client:
    return app.state.d1


def get_r2() -> R2Client:
    return app.state.r2


@app.on_event("startup")
async def on_startup() -> None:
    d1 = D1Client(
        account_id=get_env("CLOUDFLARE_ACCOUNT_ID"),
        database_id=get_env("D1_DATABASE_ID"),
        api_token=get_env("D1_API_TOKEN"),
    )
    app.state.d1 = d1
    r2 = R2Client(
        account_id=get_env("CLOUDFLARE_ACCOUNT_ID"),
        access_key_id=get_env("R2_ACCESS_KEY_ID"),
        secret_access_key=get_env("R2_SECRET_ACCESS_KEY"),
        bucket=get_env("R2_BUCKET"),
    )
    app.state.r2 = r2
    await ensure_schema(d1)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    d1: D1Client = app.state.d1
    await d1.close()


@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/dashboard")
async def api_dashboard(owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    await sync_shipping_milestones(d1, owner_email)
    stats = await get_stats(d1, owner_email)
    pipeline = await get_pipeline(d1, owner_email)
    activity = await get_activity(d1, owner_email)
    return {"stats": stats, "pipeline": pipeline, "activity": activity}


@app.get("/api/{table}")
async def api_table(table: str, owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table")
    if table in ["orders", "invoices", "shipping_schedules"]:
        await sync_shipping_milestones(d1, owner_email)
    rows = await fetch_rows(d1, table, owner_email)
    return {"rows": rows}


@app.post("/api/account/update")
async def api_account_update(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    next_email = (payload.get("email") or "").strip().lower()
    if not next_email:
        raise HTTPException(status_code=400, detail="Email required")
    if next_email == owner_email:
        return {"ok": True, "email": owner_email}
    if "@" not in next_email:
        raise HTTPException(status_code=400, detail="Invalid email")

    for table in OWNER_EMAIL_TABLES:
        row = await d1.first(f"SELECT 1 FROM {table} WHERE owner_email = ? LIMIT 1", [next_email])
        if row:
            raise HTTPException(status_code=409, detail="Email already in use")

    for table in OWNER_EMAIL_TABLES:
        await d1.execute(f"UPDATE {table} SET owner_email = ? WHERE owner_email = ?", [next_email, owner_email])

    return {"ok": True, "email": next_email}


@app.put("/api/{table}/{item_id}")
async def api_update(
    table: str,
    item_id: int,
    payload: Dict[str, Any],
    owner_email: str = Depends(require_owner_email),
    d1: D1Client = Depends(get_d1),
) -> Dict[str, Any]:
    if table not in UPDATABLE_FIELDS or item_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid table or id")
    if table == "orders":
        invoice_ids = normalize_invoice_ids(payload.get("invoice_ids") or payload.get("invoice_links"))
        if invoice_ids is not None:
            payload["invoice_ids"] = invoice_ids
    tags = normalize_tags(payload.get("tags"))
    entries = [(key, payload[key]) for key in payload if key in UPDATABLE_FIELDS[table]]
    if not entries and not tags:
        raise HTTPException(status_code=400, detail="No fields to update")

    changes = 0
    if entries:
        set_clause = ", ".join(f"{key} = ?" for key, _ in entries)
        values = [value if value is not None else None for _, value in entries]
        await d1.execute(
            f"UPDATE {table} SET {set_clause} WHERE id = ? AND owner_email = ?",
            values + [item_id, owner_email],
        )
        changes = 1

    entity_type = ENTITY_TYPES.get(table)
    if entity_type and tags:
        await d1.execute("DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ? AND owner_email = ?", [
            entity_type, item_id, owner_email
        ])
        await attach_tags(d1, owner_email, entity_type, item_id, tags)

    if table == "shipping_schedules":
        await sync_shipping_milestones(d1, owner_email)

    return {"ok": True, "changes": changes}


@app.delete("/api/{table}/{item_id}")
async def api_delete(
    table: str,
    item_id: int,
    owner_email: str = Depends(require_owner_email),
    d1: D1Client = Depends(get_d1),
) -> Dict[str, Any]:
    if table not in UPDATABLE_FIELDS or item_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid table or id")
    entity_type = ENTITY_TYPES.get(table)
    if entity_type:
        await d1.execute("DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ? AND owner_email = ?", [
            entity_type, item_id, owner_email
        ])
    if table == "orders":
        await d1.execute("DELETE FROM shipping_schedules WHERE order_id = ? AND owner_email = ?", [item_id, owner_email])
    if table == "companies":
        for target in [
            "contacts",
            "orders",
            "quotations",
            "invoices",
            "documents",
            "shipping_schedules",
            "sample_shipments",
        ]:
            if await has_column(d1, target, "company_id"):
                await d1.execute(
                    f"UPDATE {target} SET company_id = NULL WHERE company_id = ? AND owner_email = ?",
                    [item_id, owner_email],
                )
    await d1.execute(f"DELETE FROM {table} WHERE id = ? AND owner_email = ?", [item_id, owner_email])
    return {"ok": True}


@app.post("/api/contacts")
async def api_contacts(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    meta = await d1.execute(
        """
        INSERT INTO contacts (company_id, first_name, last_name, email, phone, role, status, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id"),
            payload.get("first_name"),
            payload.get("last_name"),
            payload.get("email"),
            payload.get("phone"),
            payload.get("role"),
            payload.get("status") or "Engaged",
            owner_email,
        ],
    )
    contact_id = meta.get("last_row_id")
    if contact_id:
        await attach_tags(d1, owner_email, "contact", int(contact_id), tags)
    return {"id": contact_id}


@app.post("/api/companies")
async def api_companies(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    company_code = (payload.get("company_code") or "").strip() or None
    tags = normalize_tags(payload.get("tags"))
    manual_id = payload.get("id") if isinstance(payload.get("id"), int) else None
    params = [
        manual_id,
        name,
        company_code,
        payload.get("website"),
        payload.get("email"),
        payload.get("phone"),
        payload.get("owner"),
        payload.get("industry"),
        payload.get("status") or "Active",
        payload.get("address"),
        owner_email,
    ]
    try:
        meta = await d1.execute(
            """
            INSERT INTO companies (id, name, company_code, website, email, phone, owner, industry, status, address, owner_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            params,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    company_id = meta.get("last_row_id")
    if company_id:
        await attach_tags(d1, owner_email, "company", int(company_id), tags)
    return {"id": company_id}


@app.post("/api/companies/bulk")
async def api_companies_bulk(payload: List[Dict[str, Any]], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    if not payload:
        raise HTTPException(status_code=400, detail="No companies provided")
    inserts: List[Tuple[str, List[Any]]] = []
    for company in payload:
        name = (company.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required for all companies")
        code = (company.get("company_code") or "").strip() or None
        inserts.append((
            """
            INSERT INTO companies (name, company_code, website, email, phone, owner, industry, status, address, owner_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                name,
                code,
                company.get("website"),
                company.get("email"),
                company.get("phone"),
                company.get("owner"),
                company.get("industry"),
                company.get("status") or "Active",
                company.get("address"),
                owner_email,
            ],
        ))
    await d1.batch(inserts)
    return {"inserted": len(inserts)}


@app.get("/api/companies/csv")
async def api_companies_csv(owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Response:
    rows, _ = await d1.query(
        """
        SELECT name, company_code, website, email, phone, owner, industry, status, address
        FROM companies
        WHERE owner_email = ?
        ORDER BY name
        """,
        [owner_email],
    )
    header = ["name", "company_code", "website", "email", "phone", "owner", "industry", "status", "address"]
    lines = [",".join(header)]
    for row in rows:
        lines.append(",".join(escape_csv(row.get(key)) for key in header))
    csv = "\n".join(lines)
    return Response(content=csv, media_type="text/csv", headers={
        "content-disposition": "attachment; filename=\"companies.csv\""
    })


@app.post("/api/contacts/bulk")
async def api_contacts_bulk(payload: List[Dict[str, Any]], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    if not payload:
        raise HTTPException(status_code=400, detail="No contacts provided")
    inserts = []
    for contact in payload:
        inserts.append((
            """
            INSERT INTO contacts (company_id, first_name, last_name, email, phone, role, status, owner_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                contact.get("company_id"),
                contact.get("first_name"),
                contact.get("last_name"),
                contact.get("email"),
                contact.get("phone"),
                contact.get("role"),
                contact.get("status") or "Engaged",
                owner_email,
            ],
        ))
    await d1.batch(inserts)
    return {"inserted": len(inserts)}


@app.get("/api/contacts/csv")
async def api_contacts_csv(owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Response:
    rows, _ = await d1.query(
        """
        SELECT company_id, first_name, last_name, email, phone, role, status
        FROM contacts
        WHERE owner_email = ?
        ORDER BY last_name, first_name
        """,
        [owner_email],
    )
    header = ["company_id", "first_name", "last_name", "email", "phone", "role", "status"]
    lines = [",".join(header)]
    for row in rows:
        lines.append(",".join(escape_csv(row.get(key)) for key in header))
    csv = "\n".join(lines)
    return Response(content=csv, media_type="text/csv", headers={
        "content-disposition": "attachment; filename=\"contacts.csv\""
    })


@app.post("/api/products")
async def api_products(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    meta = await d1.execute(
        """
        INSERT INTO products (name, sku, category, price, currency, status, description, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("name"),
            payload.get("sku"),
            payload.get("category"),
            payload.get("price") or 0,
            payload.get("currency") or "USD",
            payload.get("status") or "Active",
            payload.get("description"),
            owner_email,
        ],
    )
    product_id = meta.get("last_row_id")
    if product_id:
        await attach_tags(d1, owner_email, "product", int(product_id), tags)
    return {"id": product_id}


@app.post("/api/products/bulk")
async def api_products_bulk(payload: List[Dict[str, Any]], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    if not payload:
        raise HTTPException(status_code=400, detail="No products provided")
    inserts = []
    for product in payload:
        inserts.append((
            """
            INSERT INTO products (name, sku, category, price, currency, status, description, owner_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                product.get("name"),
                product.get("sku"),
                product.get("category"),
                product.get("price") or 0,
                product.get("currency") or "USD",
                product.get("status") or "Active",
                product.get("description"),
                owner_email,
            ],
        ))
    await d1.batch(inserts)
    return {"inserted": len(inserts)}


@app.get("/api/products/csv")
async def api_products_csv(owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Response:
    rows, _ = await d1.query(
        """
        SELECT name, sku, category, price, currency, status, description
        FROM products
        WHERE owner_email = ?
        ORDER BY name
        """,
        [owner_email],
    )
    header = ["name", "sku", "category", "price", "currency", "status", "description"]
    lines = [",".join(header)]
    for row in rows:
        lines.append(",".join(escape_csv(row.get(key)) for key in header))
    csv = "\n".join(lines)
    return Response(content=csv, media_type="text/csv", headers={
        "content-disposition": "attachment; filename=\"products.csv\""
    })


@app.post("/api/orders")
async def api_orders(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    invoice_ids = normalize_invoice_ids(payload.get("invoice_ids") or payload.get("invoice_links"))
    ref = payload.get("reference") or generate_ref("SO")
    meta = await d1.execute(
        """
        INSERT INTO orders (company_id, contact_id, quotation_id, invoice_ids, status, total_amount, currency, reference, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id"),
            payload.get("contact_id"),
            payload.get("quotation_id"),
            invoice_ids,
            payload.get("status") or "Pending",
            payload.get("total_amount") or 0,
            payload.get("currency") or "USD",
            ref,
            owner_email,
        ],
    )
    order_id = meta.get("last_row_id")
    if order_id:
        await attach_tags(d1, owner_email, "order", int(order_id), tags)
    return {"id": order_id}


@app.post("/api/quotations")
async def api_quotations(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    ref = payload.get("reference") or generate_ref("QUO")
    meta = await d1.execute(
        """
        INSERT INTO quotations (
            company_id, contact_id, reference, amount, currency, status, valid_until, title, tax_rate, notes, bank_charge_method, attachment_key, owner_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id"),
            payload.get("contact_id"),
            ref,
            payload.get("amount") or 0,
            payload.get("currency") or "USD",
            payload.get("status") or "Draft",
            payload.get("valid_until"),
            payload.get("title"),
            payload.get("tax_rate") or 0,
            payload.get("notes"),
            payload.get("bank_charge_method"),
            payload.get("attachment_key"),
            owner_email,
        ],
    )
    quotation_id = meta.get("last_row_id")
    if quotation_id:
        await attach_tags(d1, owner_email, "quotation", int(quotation_id), tags)
    return {"id": quotation_id}


@app.post("/api/invoices")
async def api_invoices(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    ref = payload.get("reference") or generate_ref("INV")
    meta = await d1.execute(
        """
        INSERT INTO invoices (company_id, contact_id, reference, total_amount, currency, due_date, status, attachment_key, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id"),
            payload.get("contact_id"),
            ref,
            payload.get("total_amount") or 0,
            payload.get("currency") or "USD",
            payload.get("due_date"),
            payload.get("status") or "Open",
            payload.get("attachment_key"),
            owner_email,
        ],
    )
    invoice_id = meta.get("last_row_id")
    if invoice_id:
        await attach_tags(d1, owner_email, "invoice", int(invoice_id), tags)
    return {"id": invoice_id}


@app.post("/api/shipping_schedules")
async def api_shipping(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    tags = normalize_tags(payload.get("tags"))
    meta = await d1.execute(
        """
        INSERT INTO shipping_schedules (
            order_id, invoice_id, company_id, carrier, tracking_number, factory_exit_date, etc_date, etd_date, eta, status, notes, owner_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("order_id"),
            payload.get("invoice_id"),
            payload.get("company_id"),
            payload.get("carrier"),
            payload.get("tracking_number"),
            payload.get("factory_exit_date"),
            payload.get("etc_date"),
            payload.get("etd_date"),
            payload.get("eta"),
            payload.get("status") or "Factory exit",
            payload.get("notes"),
            owner_email,
        ],
    )
    schedule_id = meta.get("last_row_id")
    if schedule_id:
        await attach_tags(d1, owner_email, "shipping", int(schedule_id), tags)
    await sync_shipping_milestones(d1, owner_email)
    return {"id": schedule_id}


@app.post("/api/sample_shipments")
async def api_sample_shipments(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    meta = await d1.execute(
        """
        INSERT INTO sample_shipments (
            company_id, product_id, document_id, receiving_address, phone, quantity, waybill_number, courier, status, notes, owner_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id"),
            payload.get("product_id"),
            payload.get("document_id"),
            payload.get("receiving_address"),
            payload.get("phone"),
            payload.get("quantity") or 0,
            payload.get("waybill_number"),
            payload.get("courier"),
            payload.get("status") or "Preparing",
            payload.get("notes"),
            owner_email,
        ],
    )
    return {"id": meta.get("last_row_id")}


@app.post("/api/tasks")
async def api_tasks(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    meta = await d1.execute(
        """
        INSERT INTO tasks (title, status, due_date, assignee, related_type, related_id, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("title"),
            payload.get("status") or "Not Started",
            payload.get("due_date"),
            payload.get("assignee"),
            payload.get("related_type"),
            payload.get("related_id"),
            owner_email,
        ],
    )
    return {"id": meta.get("last_row_id")}


@app.post("/api/notes")
async def api_notes(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    meta = await d1.execute(
        """
        INSERT INTO notes (entity_type, entity_id, body, author, note_date, owner_email)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("entity_type"),
            payload.get("entity_id"),
            payload.get("body"),
            payload.get("author"),
            payload.get("note_date"),
            owner_email,
        ],
    )
    return {"id": meta.get("last_row_id")}


@app.post("/api/tags")
async def api_tags(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    meta = await d1.execute(
        """
        INSERT INTO tags (name, color, owner_email)
        VALUES (?, ?, ?)
        """,
        [payload.get("name"), payload.get("color") or "#2563eb", owner_email],
    )
    return {"id": meta.get("last_row_id")}


@app.delete("/api/tags/{tag_id}")
async def api_delete_tag(tag_id: int, owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    await d1.execute("DELETE FROM tags WHERE id = ? AND owner_email = ?", [tag_id, owner_email])
    return {"ok": True}


@app.post("/api/doc_types")
async def api_doc_types(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    meta = await d1.execute("INSERT INTO doc_types (name, owner_email) VALUES (?, ?)", [payload.get("name"), owner_email])
    return {"id": meta.get("last_row_id")}


@app.delete("/api/doc_types/{doc_type_id}")
async def api_delete_doc_type(doc_type_id: int, owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    await d1.execute("DELETE FROM doc_types WHERE id = ? AND owner_email = ?", [doc_type_id, owner_email])
    return {"ok": True}


@app.post("/api/documents")
async def api_documents(payload: Dict[str, Any], owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1)) -> Dict[str, Any]:
    key = payload.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="Missing storage key")
    meta = await d1.execute(
        """
        INSERT INTO documents (company_id, contact_id, invoice_id, doc_type_id, title, storage_key, content_type, size, owner_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            payload.get("company_id") or payload.get("companyId"),
            payload.get("contact_id") or payload.get("contactId"),
            payload.get("invoice_id") or payload.get("invoiceId"),
            payload.get("doc_type_id"),
            payload.get("title") or "Untitled document",
            key,
            payload.get("contentType"),
            payload.get("size"),
            owner_email,
        ],
    )
    doc_id = meta.get("last_row_id")
    return {"id": doc_id}


@app.put("/api/files/{key:path}")
async def api_put_file(key: str, request: Request, owner_email: str = Depends(require_owner_email), r2: R2Client = Depends(get_r2)) -> Dict[str, Any]:
    key = key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Missing file key")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Missing file body")
    content_type = request.headers.get("content-type") or "application/octet-stream"
    r2.put(key, body, content_type)
    return {"key": key}


@app.post("/api/upload")
async def api_upload(
    owner_email: str = Depends(require_owner_email),
    d1: D1Client = Depends(get_d1),
    r2: R2Client = Depends(get_r2),
    title: str = Form("Untitled document"),
    company_id: Optional[int] = Form(None),
    contact_id: Optional[int] = Form(None),
    invoice_id: Optional[int] = Form(None),
    doc_type_id: Optional[int] = Form(None),
    tags: List[int] = Form([]),
    file: List[UploadFile] = File(...),
) -> Dict[str, Any]:
    if not file:
        raise HTTPException(status_code=400, detail="No files provided")

    results = []
    for item in file:
        if not item or not item.filename:
            continue
        contents = await item.read()
        if not contents:
            continue
        safe_name = "".join(ch if ch.isalnum() or ch in ".-" else "_" for ch in item.filename)
        key = f"uploads/{uuid.uuid4()}-{safe_name}"
        content_type = item.content_type or "application/octet-stream"
        r2.put(key, contents, content_type)
        row = await d1.first(
            """
            INSERT INTO documents (company_id, contact_id, invoice_id, doc_type_id, title, storage_key, content_type, size, owner_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, title, storage_key as key
            """,
            [
                company_id,
                contact_id,
                invoice_id,
                doc_type_id,
                title,
                key,
                content_type,
                len(contents),
                owner_email,
            ],
        )
        if row and tags:
            await attach_tags(d1, owner_email, "document", int(row.get("id")), tags)
        results.append({"key": key, "document": row})

    return {"success": True, "uploaded": len(results), "documents": results}


@app.get("/api/files/{key:path}")
async def api_get_file(key: str, owner_email: str = Depends(require_owner_email), d1: D1Client = Depends(get_d1), r2: R2Client = Depends(get_r2)) -> Response:
    key = key.strip()
    if not key:
        raise HTTPException(status_code=404, detail="Not found")
    record = await d1.first("SELECT id FROM documents WHERE storage_key = ? AND owner_email = ?", [key, owner_email])
    if not record:
        raise HTTPException(status_code=404, detail="Not found")
    obj = r2.get(key)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    filename = key.split("/")[-1] or "file"
    content_type = obj.get("ContentType") or "application/octet-stream"
    body = obj.get("Body").read()
    return Response(content=body, media_type=content_type, headers={
        "content-disposition": f'inline; filename="{filename}"'
    })


@app.exception_handler(Exception)
async def handle_exception(_: Request, exc: Exception) -> Response:
    return JSONResponse(status_code=500, content={"error": str(exc)})


@app.get("/{path:path}")
async def serve_spa(path: str) -> Response:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    file_path = PUBLIC_DIR / path
    if file_path.is_file():
        return FileResponse(file_path)
    index_path = PUBLIC_DIR / "index.html"
    if index_path.is_file():
        return FileResponse(index_path)
    return PlainTextResponse("Missing index.html", status_code=404)


async def attach_tags(d1: D1Client, owner_email: str, entity_type: str, entity_id: int, tags: List[int]) -> None:
    for tag_id in tags:
        await d1.execute(
            "INSERT OR IGNORE INTO tag_links (tag_id, entity_type, entity_id, owner_email) VALUES (?, ?, ?, ?)",
            [tag_id, entity_type, entity_id, owner_email],
        )


async def sync_shipping_milestones(d1: D1Client, owner_email: str) -> None:
    rows, _ = await d1.query(
        """
        SELECT id, status, order_id, invoice_id, factory_exit_date, etc_date, etd_date, eta
        FROM shipping_schedules WHERE owner_email = ?
        """,
        [owner_email],
    )
    if not rows:
        return
    now_ms = int(datetime.utcnow().timestamp() * 1000)
    order_statuses: Dict[int, str] = {}
    invoice_statuses: Dict[int, str] = {}

    def apply_status(target: Dict[int, str], item_id: int, status: str) -> None:
        current = target.get(item_id)
        if not current or SHIPPING_STATUS_RANK[status] > SHIPPING_STATUS_RANK[current]:
            target[item_id] = status

    for row in rows:
        computed = compute_shipping_milestone_status(row, now_ms)
        if not computed:
            continue
        if row.get("status") != computed:
            await d1.execute(
                """
                UPDATE shipping_schedules
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)
                """,
                [computed, row.get("id"), owner_email, computed],
            )
        if row.get("order_id"):
            apply_status(order_statuses, int(row["order_id"]), computed)
        if row.get("invoice_id"):
            apply_status(invoice_statuses, int(row["invoice_id"]), computed)

    for order_id, status in order_statuses.items():
        await d1.execute(
            """
            UPDATE orders
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)
            """,
            [status, order_id, owner_email, status],
        )
    for invoice_id, status in invoice_statuses.items():
        await d1.execute(
            """
            UPDATE invoices
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND owner_email = ? AND (status IS NULL OR status <> ?)
            """,
            [status, invoice_id, owner_email, status],
        )


async def get_stats(d1: D1Client, owner_email: str) -> Dict[str, int]:
    result: Dict[str, int] = {}
    for table in ["companies", "contacts", "orders", "quotations", "invoices", "tasks"]:
        row = await d1.first(f"SELECT COUNT(*) as count FROM {table} WHERE owner_email = ?", [owner_email])
        key = "openOrders" if table == "orders" else table
        result[key] = int(row.get("count") if row else 0)
    return result


async def fetch_rows(d1: D1Client, table: str, owner_email: str) -> List[Dict[str, Any]]:
    order_column = "created_at" if table in ["tags", "doc_types", "quotation_items"] else "updated_at"
    query = f"SELECT * FROM {table} WHERE owner_email = ? ORDER BY {order_column} DESC LIMIT 50"
    params: List[Any] = [owner_email]

    if table == "contacts":
        query = (
            "SELECT c.*, co.name as company_name "
            "FROM contacts c "
            "LEFT JOIN companies co ON co.id = c.company_id AND co.owner_email = ? "
            "WHERE c.owner_email = ? "
            f"ORDER BY c.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email]
    elif table == "orders":
        query = (
            "SELECT o.*, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name, "
            "GROUP_CONCAT(DISTINCT t.name) as tags "
            "FROM orders o "
            "LEFT JOIN companies co ON co.id = o.company_id AND co.owner_email = ? "
            "LEFT JOIN contacts ct ON ct.id = o.contact_id AND ct.owner_email = ? "
            "LEFT JOIN tag_links tl ON tl.entity_type = 'order' AND tl.entity_id = o.id AND tl.owner_email = ? "
            "LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ? "
            "WHERE o.owner_email = ? "
            "GROUP BY o.id "
            f"ORDER BY o.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email, owner_email, owner_email]
    elif table == "quotations":
        query = (
            "SELECT q.*, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name, "
            "GROUP_CONCAT(DISTINCT t.name) as tags "
            "FROM quotations q "
            "LEFT JOIN companies co ON co.id = q.company_id AND co.owner_email = ? "
            "LEFT JOIN contacts ct ON ct.id = q.contact_id AND ct.owner_email = ? "
            "LEFT JOIN tag_links tl ON tl.entity_type = 'quotation' AND tl.entity_id = q.id AND tl.owner_email = ? "
            "LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ? "
            "WHERE q.owner_email = ? "
            "GROUP BY q.id "
            f"ORDER BY q.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email, owner_email, owner_email]
    elif table == "invoices":
        query = (
            "SELECT i.*, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name "
            "FROM invoices i "
            "LEFT JOIN companies co ON co.id = i.company_id AND co.owner_email = ? "
            "LEFT JOIN contacts ct ON ct.id = i.contact_id AND ct.owner_email = ? "
            "WHERE i.owner_email = ? "
            f"ORDER BY i.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email]
    elif table == "documents":
        query = (
            "SELECT d.*, co.name as company_name, ct.first_name || ' ' || ct.last_name as contact_name, "
            "dt.name as doc_type_name, i.reference as invoice_reference, GROUP_CONCAT(DISTINCT t.name) as tags "
            "FROM documents d "
            "LEFT JOIN companies co ON co.id = d.company_id AND co.owner_email = ? "
            "LEFT JOIN contacts ct ON ct.id = d.contact_id AND ct.owner_email = ? "
            "LEFT JOIN doc_types dt ON dt.id = d.doc_type_id AND dt.owner_email = ? "
            "LEFT JOIN invoices i ON i.id = d.invoice_id AND i.owner_email = ? "
            "LEFT JOIN tag_links tl ON tl.entity_type = 'document' AND tl.entity_id = d.id AND tl.owner_email = ? "
            "LEFT JOIN tags t ON t.id = tl.tag_id AND t.owner_email = ? "
            "WHERE d.owner_email = ? "
            "GROUP BY d.id "
            f"ORDER BY d.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email, owner_email, owner_email, owner_email, owner_email]
    elif table == "shipping_schedules":
        query = (
            "SELECT ss.*, o.reference as order_reference, i.reference as invoice_reference, co.name as company_name "
            "FROM shipping_schedules ss "
            "LEFT JOIN orders o ON o.id = ss.order_id AND o.owner_email = ? "
            "LEFT JOIN invoices i ON i.id = ss.invoice_id AND i.owner_email = ? "
            "LEFT JOIN companies co ON co.id = ss.company_id AND co.owner_email = ? "
            "WHERE ss.owner_email = ? "
            f"ORDER BY ss.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email, owner_email]
    elif table == "sample_shipments":
        query = (
            "SELECT ss.*, co.name as company_name, p.name as product_name, d.title as document_title "
            "FROM sample_shipments ss "
            "LEFT JOIN companies co ON co.id = ss.company_id AND co.owner_email = ? "
            "LEFT JOIN products p ON p.id = ss.product_id AND p.owner_email = ? "
            "LEFT JOIN documents d ON d.id = ss.document_id AND d.owner_email = ? "
            "WHERE ss.owner_email = ? "
            f"ORDER BY ss.{order_column} DESC LIMIT 50"
        )
        params = [owner_email, owner_email, owner_email, owner_email]
    elif table == "quotation_items":
        query = (
            "SELECT qi.*, p.name as product_name "
            "FROM quotation_items qi "
            "LEFT JOIN products p ON p.id = qi.product_id AND p.owner_email = ? "
            "WHERE qi.owner_email = ? "
            "ORDER BY qi.created_at DESC LIMIT 50"
        )
        params = [owner_email, owner_email]

    rows, _ = await d1.query(query, params)
    return rows


async def get_pipeline(d1: D1Client, owner_email: str) -> List[Dict[str, Any]]:
    orders, _ = await d1.query(
        """
        SELECT o.reference AS ref, c.name AS account, o.total_amount AS amount, o.status
        FROM orders o
        LEFT JOIN companies c ON c.id = o.company_id AND c.owner_email = ?
        WHERE o.owner_email = ?
        ORDER BY o.updated_at DESC
        LIMIT 5
        """,
        [owner_email, owner_email],
    )
    invoices, _ = await d1.query(
        """
        SELECT i.reference AS ref, c.name AS account, i.total_amount AS amount, i.status
        FROM invoices i
        LEFT JOIN companies c ON c.id = i.company_id AND c.owner_email = ?
        WHERE i.owner_email = ?
        ORDER BY i.updated_at DESC
        LIMIT 5
        """,
        [owner_email, owner_email],
    )

    combined = (orders + invoices)[:6]
    result = []
    for entry in combined:
        amount = entry.get("amount")
        formatted_amount = f"${int(amount):,}" if isinstance(amount, (int, float)) else "$0"
        status = entry.get("status") or "Open"
        result.append({
            "ref": entry.get("ref"),
            "account": entry.get("account") or "Unknown",
            "amount": formatted_amount,
            "status": status,
            "statusType": status_tone(status),
        })
    return result


async def get_activity(d1: D1Client, owner_email: str) -> List[Dict[str, Any]]:
    notes, _ = await d1.query(
        """
        SELECT body, author, entity_type
        FROM notes
        WHERE owner_email = ?
        ORDER BY updated_at DESC
        LIMIT 6
        """,
        [owner_email],
    )
    if not notes:
        return []
    return [
        {
            "title": note.get("body"),
            "tag": note.get("entity_type"),
            "color": "#2563eb",
            "author": note.get("author"),
        }
        for note in notes
    ]
