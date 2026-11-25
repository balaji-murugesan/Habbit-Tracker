<#
  Checks why a phone can't reach the Habit Tracker on this Windows computer.

  Read-only by default:
      powershell -ExecutionPolicy Bypass -File scripts\check-phone-access.ps1

  To also fix what it finds (run PowerShell as Administrator):
      powershell -ExecutionPolicy Bypass -File scripts\check-phone-access.ps1 -Fix

  -Fix only touches the Habit Tracker: it removes Docker *block* firewall rules,
  adds one allow rule for ports 8080/8081 from your home network and Tailscale,
  and restarts the container with the current docker-compose.yml.
#>
param(
  [switch]$Fix,
  [int]$Port = 0
)

$ErrorActionPreference = 'SilentlyContinue'
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "         $m" -ForegroundColor Gray }
function Head($m) { Write-Host "`n$m" -ForegroundColor Cyan }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Fix -and -not $isAdmin) {
  Write-Host "Run PowerShell as Administrator to use -Fix (right-click PowerShell > Run as administrator)." -ForegroundColor Red
  exit 1
}
$problems = @()

# ---------------------------------------------------------------- Docker
Head "1. Docker container"
$ports = (docker ps --filter "name=habit-tracker" --format "{{.Ports}}") -join ' '
if (-not $ports) {
  Bad "The habit-tracker container is not running."
  Info "Start it from the project folder:  docker compose up -d --build"
  $problems += 'container'
} else {
  Info "Published ports: $ports"
  if ($Port -eq 0) {
    if ($ports -match ':(\d+)->3000') { $Port = [int]$Matches[1] } else { $Port = 8080 }
  }
  if ($ports -match '127\.0\.0\.1:') {
    Bad "Docker only listens on 127.0.0.1 - other devices can't reach it."
    $problems += 'binding'
  } else {
    Ok "Docker listens on all addresses (port $Port)."
  }
}
if ($Port -eq 0) { $Port = 8080 }

# ---------------------------------------------------------------- IPs
Head "2. This computer's addresses"
$lan = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -match '^(192\.168|10\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback' } |
  Select-Object -First 1
$ts = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '100.*' } | Select-Object -First 1
if ($lan) { Ok "Home network: $($lan.IPAddress)  ($($lan.InterfaceAlias))" } else { Warn "No home-network (192.168.x / 10.x) address found." }
if ($ts)  { Ok "Tailscale:    $($ts.IPAddress)" } else { Info "Tailscale: not installed or not connected." }

# ---------------------------------------------------------------- HTTP
Head "3. Can the app be reached on this computer?"
function Probe($url) {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "$url/healthz").Content -match '"ok":true' } catch { $false }
}
if (Probe "http://localhost:$Port") { Ok "http://localhost:$Port works." } else { Bad "http://localhost:$Port does not answer."; $problems += 'local' }
if ($lan) {
  if (Probe "http://$($lan.IPAddress):$Port") { Ok "http://$($lan.IPAddress):$Port works." }
  else { Bad "http://$($lan.IPAddress):$Port does not answer (Docker binding)."; $problems += 'binding' }
}

# ---------------------------------------------------------------- Network profile
Head "4. Network type"
Get-NetConnectionProfile | ForEach-Object {
  if ($_.NetworkCategory -eq 'Public') { Warn "$($_.InterfaceAlias): Public (Windows blocks incoming connections more strictly)"; $problems += 'public' }
  else { Ok "$($_.InterfaceAlias): $($_.NetworkCategory)" }
}

# ---------------------------------------------------------------- Firewall
Head "5. Firewall"
$blocks = Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True |
  Where-Object { $_.DisplayName -match 'docker|com\.docker|vpnkit|wsl' }
if ($blocks) {
  Bad "Docker is BLOCKED by these rules (they override any allow rule):"
  $blocks | ForEach-Object { Info "- $($_.DisplayName)  [$($_.Profile)]" }
  $problems += 'block'
} else { Ok "No firewall rules block Docker." }
$allow = Get-NetFirewallRule -DisplayName 'Habit Tracker (phone)'
if ($allow) { Ok "Allow rule 'Habit Tracker (phone)' exists." } else { Warn "No allow rule for the habit ports yet."; $problems += 'allow' }

# ---------------------------------------------------------------- Fix
if ($Fix) {
  Head "Fixing"
  if ($problems -contains 'block') {
    $blocks | Remove-NetFirewallRule
    Ok "Removed Docker block rules."
  }
  if (-not $allow) {
    New-NetFirewallRule -DisplayName 'Habit Tracker (phone)' -Direction Inbound -Protocol TCP `
      -LocalPort 8080,8081 -RemoteAddress @('192.168.0.0/16','10.0.0.0/8','100.64.0.0/10') `
      -Action Allow -Profile Any | Out-Null
    Ok "Added allow rule for ports 8080/8081 from home network and Tailscale only."
  }
  if ($problems -contains 'binding' -and (Test-Path (Join-Path $PSScriptRoot '..\docker-compose.yml'))) {
    Push-Location (Join-Path $PSScriptRoot '..')
    git pull --ff-only | Out-Null
    if ($Port -ne 8080) { $env:HOST_PORT = "$Port" }
    docker compose up -d --build | Out-Null
    Pop-Location
    Ok "Updated and restarted the container (now listens on 0.0.0.0)."
  }
  if ($problems -contains 'public') {
    Warn "Your network is set to Public. Change it: Settings > Network & internet > (Wi-Fi/Ethernet) > Private network."
  }
  Write-Host "`nRun the script again without -Fix to confirm." -ForegroundColor Cyan
}

# ---------------------------------------------------------------- Summary
Head "Result"
if ($problems.Count -eq 0 -or ($problems | Where-Object { $_ -ne 'allow' -and $_ -ne 'public' }).Count -eq 0) {
  Ok "This computer looks ready."
  if ($lan) { Info "On the phone (same Wi-Fi), open:  http://$($lan.IPAddress):$Port" }
  if ($ts)  { Info "Or with Tailscale on the phone:   http://$($ts.IPAddress):$Port" }
  Info "If Chrome on the phone still can't open it, your router is isolating Wi-Fi devices"
  Info "(look for 'AP/client isolation' in the router), or use the Tailscale address."
} elseif (-not $Fix) {
  Warn "Problems found. Re-run in an Administrator PowerShell with -Fix to repair them."
}
