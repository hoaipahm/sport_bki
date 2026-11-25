param([int]$ApiPort = 4000, [int]$WebPort = 3000)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $repoRoot '.runtime'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.env'))) { throw 'Configure .env before starting.' }

function Test-LocalPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $client.Connected }
  catch { return $false }
  finally { $client.Dispose() }
}

# This private cluster was provisioned for the local review. Other installations can use Compose.
$clusterDir = Join-Path $runtimeDir 'postgres'
if ((Test-Path -LiteralPath $clusterDir) -and -not (Test-LocalPort 55432)) {
  $pgCtl = 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe'
  if (-not (Test-Path -LiteralPath $pgCtl)) { throw 'PostgreSQL 18 binaries are required for this local cluster.' }
  & $pgCtl -D $clusterDir -l (Join-Path $runtimeDir 'postgres.log') -o '-p 55432 -h 127.0.0.1' start
  if ($LASTEXITCODE -ne 0) { throw 'Private PostgreSQL startup failed.' }
}
$redisExe = Get-ChildItem -LiteralPath (Join-Path $runtimeDir 'redis') -Filter redis-server.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($redisExe -and -not (Test-LocalPort 56379)) {
  Start-Process -FilePath $redisExe.FullName -ArgumentList '--bind 127.0.0.1 --port 56379 --save "" --appendonly no' -WorkingDirectory $runtimeDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'redis.log') -RedirectStandardError (Join-Path $runtimeDir 'redis-error.log') | Out-Null
}
$nodeExe = (Get-Command node).Source
if (-not (Test-LocalPort $ApiPort)) {
  $apiEntry = Join-Path $repoRoot 'backend/dist/backend/src/main.js'
  if (-not (Test-Path -LiteralPath $apiEntry)) { throw 'Build backend first: npm --prefix backend run build' }
  Start-Process -FilePath $nodeExe -ArgumentList ('"{0}"' -f $apiEntry) -WorkingDirectory (Join-Path $repoRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'api.log') -RedirectStandardError (Join-Path $runtimeDir 'api-error.log') | Out-Null
}
if (-not (Test-LocalPort $WebPort)) {
  $webEntry = Join-Path $repoRoot 'frontend/node_modules/next/dist/bin/next'
  Start-Process -FilePath $nodeExe -ArgumentList ('"{0}" start -p {1} -H 127.0.0.1' -f $webEntry, $WebPort) -WorkingDirectory (Join-Path $repoRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'web.log') -RedirectStandardError (Join-Path $runtimeDir 'web-error.log') | Out-Null
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/health" -TimeoutSec 3
    $page = Invoke-WebRequest "http://127.0.0.1:$WebPort" -UseBasicParsing -TimeoutSec 3
    if ($health.status -eq 'UP' -and $page.StatusCode -eq 200) {
      Write-Output "Web: http://localhost:$WebPort"
      Write-Output "API: http://localhost:$ApiPort/health ($($health.database), $($health.redis))"
      exit 0
    }
  } catch { }
  Start-Sleep -Milliseconds 500
}
throw 'Startup did not become healthy. Inspect .runtime logs and configured ports.'
