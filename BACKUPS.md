# Backups

This project uses a manual, external backup flow (no runtime impact) that exports D1 schema + data and downloads all document objects from R2 using Wrangler.

## Architecture (short)
- D1: Export schema and data separately using `wrangler d1 export`.
- Documents: Query D1 for all file keys, then download each object from R2 with `wrangler r2 object get`.
- Config: Copy `schema.sql`, `wrangler.toml`, and `wrangler-container.toml` into the backup for human verification.

## Folder Structure (example)
```
backups/
  20250101-120000/
    backup.json
    d1/
      schema.sql
      data.sql
      tables.json
      row_counts.json
    documents/
      keys.sql
      manifest.json
      objects/
        uploads/
          1234-abc.pdf
    config/
      schema.sql
      wrangler.toml
      wrangler-container.toml
```

## Manual Commands (D1)
Schema only:
```
wrangler d1 export tcm-crm --remote --no-data --output backups/<timestamp>/d1/schema.sql
```

Schema + data:
```
wrangler d1 export tcm-crm --remote --no-schema --output backups/<timestamp>/d1/data.sql
```

## Manual Script (All Backups)
Run once, safe to repeat:
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1
```

Optional overrides:
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1 -DatabaseName tcm-crm -BucketName crmforall-files
```

## Restore Guide

### Restore schema only
1) Create a new D1 database if needed.
2) Apply schema:
```
wrangler d1 execute <db-name> --remote --file backups/<timestamp>/d1/schema.sql
```

### Restore schema + data
1) Apply schema:
```
wrangler d1 execute <db-name> --remote --file backups/<timestamp>/d1/schema.sql
```
2) Apply data:
```
wrangler d1 execute <db-name> --remote --file backups/<timestamp>/d1/data.sql
```

### Restore documents (R2)
Use the manifest to restore keys exactly as saved:
```
$manifest = Get-Content backups/<timestamp>/documents/manifest.json | ConvertFrom-Json
foreach ($item in $manifest) {
  if ($item.status -ne "downloaded") { continue }
  $filePath = Join-Path "backups/<timestamp>/documents/objects" $item.key
  $objectPath = "crmforall-files/$($item.key)"
  if ($item.content_type) {
    wrangler r2 object put $objectPath --remote --file $filePath --content-type $item.content_type
  } else {
    wrangler r2 object put $objectPath --remote --file $filePath
  }
}
```

## Verification Checklist
- D1 export files exist: `d1/schema.sql` and `d1/data.sql`.
- `d1/tables.json` matches production tables.
- `d1/row_counts.json` looks reasonable and can be re-queried post-restore.
- `documents/manifest.json` includes all expected keys and sources.
- Every manifest entry has `status: downloaded` (or investigate missing).
- Spot-check 2-3 restored objects by key (download + open).
