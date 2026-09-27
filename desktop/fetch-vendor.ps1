# Downloads the native Windows services used by the desktop build into desktop/vendor:
#   - Redis 7.2 (BSD-licensed line, same major version as CVAT's docker image)
#   - Open Policy Agent (same version as CVAT's docker-compose.yml)
# Usage: powershell -ExecutionPolicy Bypass -File desktop/fetch-vendor.ps1
$ErrorActionPreference = "Stop"
$vendor = Join-Path $PSScriptRoot "vendor"

$redisVersion = "7.2.16"
$redisZip = "Redis-$redisVersion-Windows-x64-msys2.zip"
$redisSha256 = "bcbfda1dda027beaea4d616f8992f9b6353613c1b1f4d0e4a6776940bb036347"
$opaVersion = "v1.12.2"
$opaSha256 = "020d77b16bb608393b3e0cfcadadae887f929f0fe3f5ee8caaeb1cb374a7800d"

function Get-Checked($url, $out, $sha256) {
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $out
    $actual = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
    if ($actual -ne $sha256) { throw "Checksum mismatch for $out ($actual)" }
}

if (-not (Test-Path "$vendor\redis\redis-server.exe")) {
    $tmp = Join-Path $env:TEMP $redisZip
    Get-Checked "https://github.com/redis-windows/redis-windows/releases/download/$redisVersion/$redisZip" $tmp $redisSha256
    $unz = Join-Path $env:TEMP "redis-unz"
    if (Test-Path $unz) { Remove-Item -Recurse -Force $unz }
    Expand-Archive $tmp $unz
    New-Item -ItemType Directory -Force "$vendor\redis" | Out-Null
    Copy-Item -Recurse -Force "$unz\*\*" "$vendor\redis\"
    Remove-Item -Recurse -Force $unz, $tmp
}

if (-not (Test-Path "$vendor\opa\opa.exe")) {
    New-Item -ItemType Directory -Force "$vendor\opa" | Out-Null
    Get-Checked "https://github.com/open-policy-agent/opa/releases/download/$opaVersion/opa_windows_amd64.exe" "$vendor\opa\opa.exe" $opaSha256
}

Write-Host "Vendor binaries are in $vendor"
