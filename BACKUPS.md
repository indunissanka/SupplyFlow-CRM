# Backups

SupplyFlow-CRM uses MongoDB and stores uploaded files on local disk. Backups can be triggered from within the app (Settings → Backup) or via the API/scripts.

## What Gets Backed Up

- **MongoDB data** — all collections: companies, contacts, orders, quotations, invoices, shipping schedules, meetings, tasks, notes, documents, products, tags, users, site config
- **Uploaded files** — PDFs and images stored in `uploads/`

---

## In-App Backup (Recommended)

Navigate to **Settings → Backup** in the CRM. From there you can:

- Create a backup (downloads a `.zip` of all data + uploaded files)
- Restore from a previously downloaded `.zip`
- List and delete old backups

---

## API Backup

All backup endpoints require `Authorization: Bearer <token>`.

```
GET    /api/backup/list                  List available backups
POST   /api/backup/create               Create new backup
GET    /api/backup/download/:filename   Download a backup zip
POST   /api/backup/restore/:filename    Restore from a stored backup
POST   /api/backup/upload-restore       Upload a zip and restore
DELETE /api/backup/:filename            Delete a backup
```

---

## Script Backup (Linux/macOS)

```bash
bash scripts/backup-mongodb.sh
```

Creates a timestamped `mongodump` archive in `backups/`.

## Script Backup (Windows)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1
```

---

## Backup Folder Structure

```
backups/
  20250401-120000.zip
    data/
      companies.json
      contacts.json
      orders.json
      meetings.json
      ...
    uploads/
      1234-abc.pdf
      5678-def.jpg
```

---

## Restore Guide

### From in-app backup

1. Go to **Settings → Backup**
2. Click **Upload & Restore**
3. Select the `.zip` backup file
4. Confirm — all existing data is replaced

### From mongodump archive

```bash
mongorestore --uri="mongodb://localhost:27017" --db crmmango backups/<timestamp>/
```

### Docker volume restore

If running via Docker Compose, the MongoDB data lives in the `mongo_data` named volume. To restore:

```bash
docker compose down
docker volume rm supplyflow-crm_mongo_data
docker compose up -d mongo
# wait for mongo to start, then restore
mongorestore --uri="mongodb://localhost:27017" --db crmmango backups/<timestamp>/
docker compose up -d app
```

---

## Verification Checklist

- All collection `.json` files are present in the backup
- Row counts look reasonable compared to before backup
- `uploads/` directory contains expected files
- Test login after restore to confirm user records are intact
- Spot-check 2–3 records across companies, orders, and meetings
