import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection

BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / "public"

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

ADMIN_ROLE = "Admin"
SALES_ROLE = "Salesperson"
DEFAULT_ACCESS_LIST = [
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
    "settings",
]

SHIPPING_STATUS_RANK = {
    "Factory exit": 1,
    "Dispatched": 2,
    "Cut Off": 3,
    "Shipped": 4,
    "Delivered": 5,
}

SHIPPO_CARRIER_MAP: Dict[str, str] = {
    "dhl": "dhl_express",
    "dhl express": "dhl_express",
    "dhl ecommerce": "dhl_ecommerce",
    "fedex": "fedex",
    "fedex express": "fedex",
    "ups": "ups",
    "sf express": "sf_express",
    "aramex": "aramex",
    "royal mail": "royal_mail",
}

def resolve_shippo_carrier(value: str) -> Optional[str]:
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    return SHIPPO_CARRIER_MAP.get(normalized) or normalized

class MongoDBClient:
    def __init__(self, uri: str, db_name: str) -> None:
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
    
    def get_collection(self, name: str) -> Collection:
        return self.db[name]
    
    async def close(self) -> None:
        self.client.close()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)

def get_mongodb() -> MongoDBClient:
    return app.state.mongodb

def require_owner_email(request: Request) -> str:
    owner_email = (request.headers.get("x-user-email") or "").strip().lower()
    if not owner_email:
        raise HTTPException(status_code=401, detail="Missing user context")
    return owner_email

@app.on_event("startup")
async def on_startup() -> None:
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db = os.getenv("MONGODB_DB_NAME", "crmcloudflare")
    mongodb = MongoDBClient(mongodb_uri, mongodb_db)
    app.state.mongodb = mongodb
    
    # Ensure indexes
    collections = ["companies", "contacts", "orders", "quotations", "invoices", "users"]
    for coll_name in collections:
        collection = mongodb.get_collection(coll_name)
        if coll_name == "companies":
            collection.create_index("owner_email")
        elif coll_name == "contacts":
            collection.create_index([("owner_email", 1), ("company_id", 1)])
        elif coll_name in ["orders", "quotations", "invoices"]:
            collection.create_index([("owner_email", 1), ("created_at", -1)])
        elif coll_name == "users":
            collection.create_index("email", unique=True)

@app.on_event("shutdown")
async def on_shutdown() -> None:
    mongodb: MongoDBClient = app.state.mongodb
    await mongodb.close()

@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/dashboard")
async def api_dashboard(
    owner_email: str = Depends(require_owner_email),
    mongodb: MongoDBClient = Depends(get_mongodb)
) -> Dict[str, Any]:
    # Simplified dashboard - in production, implement proper aggregation
    stats = {}
    for table in ["companies", "contacts", "orders", "quotations", "invoices", "tasks"]:
        collection = mongodb.get_collection(table)
        count = collection.count_documents({"owner_email": owner_email})
        key = "openOrders" if table == "orders" else table
        stats[key] = count
    
    return {"stats": stats, "pipeline": [], "activity": []}

@app.get("/api/tracking/shippo")
async def api_tracking_shippo(
    waybill: str,
    courier: str = "",
    owner_email: str = Depends(require_owner_email),
) -> Dict[str, Any]:
    api_key = os.getenv("SHIPPO_API_KEY")
    if not api_key:
        raise HTTPException(status_code=501, detail="Shippo API key not configured")
    if not waybill:
        raise HTTPException(status_code=400, detail="Missing waybill number")
    carrier = resolve_shippo_carrier(courier)
    if not carrier:
        raise HTTPException(status_code=400, detail="Carrier required for tracking")

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.goshippo.com/tracks/",
            json={"carrier": carrier, "tracking_number": waybill},
            headers={"Authorization": f"ShippoToken {api_key}"},
        )
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Tracking lookup failed")
    data = resp.json()
    tracking_status = data.get("tracking_status") or {}
    tracking_history = data.get("tracking_history") or []
    tracking_details = [
        {
            "status": detail.get("status"),
            "message": detail.get("status_details"),
            "datetime": detail.get("status_date"),
            "tracking_location": detail.get("location"),
        }
        for detail in tracking_history
    ]
    return {
        "carrier": data.get("carrier") or carrier,
        "tracking_code": data.get("tracking_number") or waybill,
        "status": tracking_status.get("status"),
        "status_detail": tracking_status.get("status_details"),
        "updated_at": tracking_status.get("status_date"),
        "est_delivery_date": data.get("eta"),
        "tracking_details": tracking_details,
    }

@app.get("/api/{table}")
async def api_table(
    table: str, 
    owner_email: str = Depends(require_owner_email),
    mongodb: MongoDBClient = Depends(get_mongodb)
) -> Dict[str, Any]:
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table")
    
    collection = mongodb.get_collection(table)
    rows = list(collection.find({"owner_email": owner_email}).limit(50))
    
    # Convert ObjectId to string for JSON serialization
    for row in rows:
        row["_id"] = str(row["_id"])
    
    return {"rows": rows}

@app.post("/api/contacts")
async def api_contacts(
    payload: Dict[str, Any], 
    owner_email: str = Depends(require_owner_email),
    mongodb: MongoDBClient = Depends(get_mongodb)
) -> Dict[str, Any]:
    collection = mongodb.get_collection("contacts")
    contact_data = {
        "company_id": payload.get("company_id"),
        "first_name": payload.get("first_name"),
        "last_name": payload.get("last_name"),
        "email": payload.get("email"),
        "phone": payload.get("phone"),
        "role": payload.get("role"),
        "status": payload.get("status") or "Engaged",
        "owner_email": owner_email,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    result = collection.insert_one(contact_data)
    return {"id": str(result.inserted_id)}

@app.post("/api/companies")
async def api_companies(
    payload: Dict[str, Any], 
    owner_email: str = Depends(require_owner_email),
    mongodb: MongoDBClient = Depends(get_mongodb)
) -> Dict[str, Any]:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    
    collection = mongodb.get_collection("companies")
    company_data = {
        "name": name,
        "company_code": (payload.get("company_code") or "").strip() or None,
        "website": payload.get("website"),
        "email": payload.get("email"),
        "phone": payload.get("phone"),
        "owner": payload.get("owner"),
        "industry": payload.get("industry"),
        "status": payload.get("status") or "Active",
        "address": payload.get("address"),
        "owner_email": owner_email,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    result = collection.insert_one(company_data)
    return {"id": str(result.inserted_id)}

# Additional CRUD endpoints would be implemented similarly...

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