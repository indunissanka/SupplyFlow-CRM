param(
  [string]$OutRoot = "backups",
  [string]$ConfigPath = "wrangler.toml",
  [string]$DatabaseId,
  [string]$DatabaseName,
  [string]$BucketName,
  [switch]$SkipDb,
  [switch]$SkipDocs
)

function Get-TomlValue {
  param(
    [string]$Path,
    [string]$Key
  )
  $match = Select-String -Path $Path -Pattern "^\s*$Key\s*=\s*\"([^\"]+)\"" -AllMatches
  if ($match -and $match.Matches.Count -gt 0) {
    return $match.Matches[0].Groups[1].Value
  }
  return $null
}

function Resolve-DatabaseName {
  param(
    [string]$DbId
  )
  if (-not $DbId) {
    return $null
  }
  $dbList = wrangler d1 list --json | ConvertFrom-Json
  $match = $dbList | Where-Object { $_.uuid -eq $DbId } | Select-Object -First 1
  if ($match) {
    return $match.name
  }
  return $null
}

if (-not (Test-Path $ConfigPath)) {
  throw "Missing config file: $ConfigPath"
}

if (-not $DatabaseId) {
  $DatabaseId = Get-TomlValue -Path $ConfigPath -Key "database_id"
}
if (-not $BucketName) {
  $BucketName = Get-TomlValue -Path $ConfigPath -Key "bucket_name"
}
if (-not $DatabaseName) {
  $DatabaseName = Resolve-DatabaseName -DbId $DatabaseId
}

if (-not $DatabaseName) {
  throw "DatabaseName could not be resolved. Pass -DatabaseName explicitly."
}
if (-not $BucketName -and -not $SkipDocs) {
  throw "BucketName could not be resolved. Pass -BucketName explicitly."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $OutRoot $timestamp
$dbDir = Join-Path $backupRoot "d1"
$docsDir = Join-Path $backupRoot "documents"
$configDir = Join-Path $backupRoot "config"

New-Item -ItemType Directory -Force $backupRoot, $dbDir, $docsDir, $configDir | Out-Null

$meta = [ordered]@{
  created_at = (Get-Date).ToString("s")
  database_id = $DatabaseId
  database_name = $DatabaseName
  bucket_name = $BucketName
}
$meta | ConvertTo-Json | Set-Content -Path (Join-Path $backupRoot "backup.json")

if (-not $SkipDb) {
  $schemaPath = Join-Path $dbDir "schema.sql"
  $dataPath = Join-Path $dbDir "data.sql"
  wrangler d1 export $DatabaseName --remote --no-data --output $schemaPath | Out-Null
  wrangler d1 export $DatabaseName --remote --no-schema --output $dataPath | Out-Null

  $tablesJson = wrangler d1 execute $DatabaseName --remote --yes --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" --json | ConvertFrom-Json
  $tables = @()
  if ($tablesJson.Count -gt 0 -and $tablesJson[0].results) {
    $tables = $tablesJson[0].results | ForEach-Object { $_.name }
  }
  $tables | ConvertTo-Json | Set-Content -Path (Join-Path $dbDir "tables.json")

  $counts = @()
  foreach ($table in $tables) {
    $countSql = "SELECT COUNT(*) as count FROM `"$table`";"
    $countJson = wrangler d1 execute $DatabaseName --remote --yes --command $countSql --json | ConvertFrom-Json
    $countValue = 0
    if ($countJson.Count -gt 0 -and $countJson[0].results -and $countJson[0].results.Count -gt 0) {
      $countValue = $countJson[0].results[0].count
    }
    $counts += [pscustomobject]@{ table = $table; count = $countValue }
  }
  $counts | ConvertTo-Json | Set-Content -Path (Join-Path $dbDir "row_counts.json")
}

if (-not $SkipDocs) {
  $keysSqlPath = Join-Path $docsDir "keys.sql"
  @"
SELECT storage_key as key, content_type, size, created_at, updated_at, 'documents' as source
FROM documents
WHERE storage_key IS NOT NULL AND storage_key <> ''
UNION
SELECT attachment_key as key, NULL as content_type, NULL as size, NULL as created_at, NULL as updated_at, 'quotations' as source
FROM quotations
WHERE attachment_key IS NOT NULL AND attachment_key <> ''
UNION
SELECT attachment_key as key, NULL as content_type, NULL as size, NULL as created_at, NULL as updated_at, 'invoices' as source
FROM invoices
WHERE attachment_key IS NOT NULL AND attachment_key <> '';
"@ | Set-Content -Path $keysSqlPath

  $keysJson = wrangler d1 execute $DatabaseName --remote --yes --file $keysSqlPath --json | ConvertFrom-Json
  $rows = @()
  if ($keysJson.Count -gt 0 -and $keysJson[0].results) {
    $rows = $keysJson[0].results
  }

  $keyMap = @{}
  foreach ($row in $rows) {
    $key = ($row.key | ForEach-Object { $_ }).ToString().Trim()
    if (-not $key) { continue }
    if (-not $keyMap.ContainsKey($key)) {
      $keyMap[$key] = [ordered]@{
        key = $key
        sources = @()
        content_type = $row.content_type
        size = $row.size
        created_at = $row.created_at
        updated_at = $row.updated_at
        status = "pending"
      }
    }
    if ($row.source -and -not ($keyMap[$key].sources -contains $row.source)) {
      $keyMap[$key].sources += $row.source
    }
  }

  $objectsDir = Join-Path $docsDir "objects"
  New-Item -ItemType Directory -Force $objectsDir | Out-Null

  $manifestItems = $keyMap.Values | Sort-Object key
  foreach ($item in $manifestItems) {
    $destPath = Join-Path $objectsDir $item.key
    $destDir = Split-Path $destPath -Parent
    if ($destDir) {
      New-Item -ItemType Directory -Force $destDir | Out-Null
    }
    if (Test-Path $destPath) {
      $item.status = "skipped_exists"
      continue
    }
    $objectPath = "$BucketName/$($item.key)"
    wrangler r2 object get $objectPath --remote --file $destPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
      if (Test-Path $destPath) { Remove-Item $destPath -Force }
      $item.status = "missing_or_error"
    } else {
      $item.status = "downloaded"
    }
  }

  $manifestItems | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $docsDir "manifest.json")
}

Copy-Item -Path "schema.sql" -Destination $configDir -Force
Copy-Item -Path "wrangler.toml" -Destination $configDir -Force
if (Test-Path "wrangler-container.toml") {
  Copy-Item -Path "wrangler-container.toml" -Destination $configDir -Force
}

Write-Host "Backup complete: $backupRoot"
