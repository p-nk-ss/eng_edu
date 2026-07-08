<#
  Portable local PostgreSQL for this project — no system install, no Windows service.
  Binaries live in .pgsql\ and the data cluster in .pgdata\ (both inside the project,
  git-ignored). Usage:
    npm run db:setup   # one-time: download binaries, init cluster, create the DB
    npm run db:start   # start the server (idempotent)
    npm run db:stop    # stop the server
    powershell -File scripts/db.ps1 status | psql
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('setup', 'start', 'stop', 'status', 'psql')]
  [string]$cmd
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$pgDir   = Join-Path $root '.pgsql'
$pgBin   = Join-Path $pgDir 'pgsql\bin'          # EDB zip extracts a top-level 'pgsql' folder
$dataDir = Join-Path $root '.pgdata'
$logFile = Join-Path $dataDir 'server.log'
$port    = if ($env:PGPORT) { $env:PGPORT } else { '5432' }
$dbName  = 'english_trainer'
$zipUrl  = if ($env:PG_BINARIES_URL) { $env:PG_BINARIES_URL } else {
  'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip'
}
$zipPath = Join-Path $root '.pg-binaries.zip'

function Exe([string]$name) { Join-Path $pgBin $name }

function Ensure-Binaries {
  if (Test-Path (Exe 'pg_ctl.exe')) { return }
  if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading PostgreSQL binaries (~330 MB) ..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
  }
  Write-Host "Extracting to $pgDir ..."
  Expand-Archive -Path $zipPath -DestinationPath $pgDir -Force
  Remove-Item $zipPath -ErrorAction SilentlyContinue
}

function Is-Running {
  if (-not (Test-Path (Exe 'pg_ctl.exe'))) { return $false }
  & (Exe 'pg_ctl.exe') -D $dataDir status *> $null
  return ($LASTEXITCODE -eq 0)
}

function Start-Db {
  if (-not (Test-Path (Exe 'pg_ctl.exe'))) {
    Write-Host "PostgreSQL is not set up yet. Run: npm run db:setup"
    return
  }
  if (Is-Running) { Write-Host "PostgreSQL already running on port $port."; return }
  & (Exe 'pg_ctl.exe') -D $dataDir -o "-p $port" -l $logFile -w start
  Write-Host "PostgreSQL started on port $port."
}

function Stop-Db {
  if (Test-Path (Exe 'pg_ctl.exe')) {
    if (Is-Running) { & (Exe 'pg_ctl.exe') -D $dataDir -w -m fast stop } else { Write-Host "Not running." }
  }
}

function Setup-Db {
  Ensure-Binaries
  if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
    Write-Host "Initializing cluster in $dataDir ..."
    & (Exe 'initdb.exe') -D $dataDir -U postgres -A trust -E UTF8 --no-locale
  }
  Start-Db
  $exists = & (Exe 'psql.exe') -h localhost -p $port -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
  if ("$exists".Trim() -ne '1') {
    Write-Host "Creating database $dbName ..."
    & (Exe 'createdb.exe') -h localhost -p $port -U postgres $dbName
  } else {
    Write-Host "Database $dbName already exists."
  }
  Write-Host ""
  Write-Host "Done. Put this in .env.local:"
  Write-Host "  DATABASE_URL=postgresql://postgres:postgres@localhost:$port/$dbName"
  Write-Host "Then create the tables: npx prisma migrate dev --name init"
}

switch ($cmd) {
  'setup'  { Setup-Db }
  'start'  { Start-Db }
  'stop'   { Stop-Db }
  'status' { if (Is-Running) { Write-Host "running (port $port)" } else { Write-Host "stopped" } }
  'psql'   { & (Exe 'psql.exe') -h localhost -p $port -U postgres $dbName }
}
