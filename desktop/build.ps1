# Builds the CVAT desktop app for Windows.
# Output: desktop/electron/release/CVATDesktop-Setup-<version>.exe (installer) and a zip.
#
# Requirements: Node.js + corepack (yarn), the development venv (.venv, see desktop/README.md)
# which provides uv and the standalone Python 3.12 it was created from.
#
# Usage: powershell -ExecutionPolicy Bypass -File desktop/build.ps1 [-SkipUI] [-SkipPython]
param([switch]$SkipUI, [switch]$SkipPython)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = $PSScriptRoot
$staging = Join-Path $desktop "staging"
$uv = Join-Path $root ".venv\Scripts\uv.exe"

function Invoke-Checked([string]$what, [scriptblock]$block) {
    Write-Host "==> $what"
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

& "$desktop\fetch-vendor.ps1"

# 1. UI (desktop mode hides features that need extra services)
if (-not $SkipUI) {
    Push-Location "$root\cvat-ui"
    $env:CVAT_DESKTOP = "true"
    $env:SOURCE_MAPS_ENABLED = "false"
    Invoke-Checked "Building UI" { node ..\node_modules\webpack-cli\bin\cli.js --config ./webpack.config.js }
    Pop-Location
}

# 2. Python runtime: relocatable standalone CPython + all backend dependencies
$python = Join-Path $staging "python\python.exe"
if (-not $SkipPython) {
    if (Test-Path "$staging\python") { Remove-Item -Recurse -Force "$staging\python" }
    $venvCfg = Get-Content "$root\.venv\pyvenv.cfg" | Where-Object { $_ -match '^home\s*=' }
    $pythonHome = ($venvCfg -split '=', 2)[1].Trim()
    Write-Host "==> Copying Python from $pythonHome"
    robocopy $pythonHome "$staging\python" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ | Out-Null
    Remove-Item -Force "$staging\python\Lib\EXTERNALLY-MANAGED" -ErrorAction SilentlyContinue

    Invoke-Checked "Installing backend dependencies" {
        & $uv pip install --python $python --break-system-packages -r "$desktop\requirements-windows.txt"
    }
    # dependencies of datumaro are part of requirements-windows.txt; --no-deps keeps the
    # headless OpenCV build instead of pulling opencv-python
    $wheel = Get-ChildItem "$desktop\wheels\datumaro-*-cp312-*win_amd64.whl" | Select-Object -First 1
    Invoke-Checked "Installing datumaro" {
        & $uv pip install --python $python --break-system-packages --no-deps $wheel.FullName
    }
}

# 3. Backend sources
Write-Host "==> Copying backend sources"
if (Test-Path "$staging\backend") { Remove-Item -Recurse -Force "$staging\backend" }
robocopy "$root\cvat" "$staging\backend\cvat" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ tests requirements | Out-Null
robocopy "$root\utils\dataset_manifest" "$staging\backend\utils\dataset_manifest" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ | Out-Null
Copy-Item "$root\utils\__init__.py" "$staging\backend\utils\"
Copy-Item "$root\manage.py", "$root\rqscheduler.py" "$staging\backend\"

# 4. Static files (Django admin/DRF assets, logo)
if (Test-Path "$staging\static") { Remove-Item -Recurse -Force "$staging\static" }
$tmpData = Join-Path $env:TEMP "cvat-desktop-build-data"
$env:DJANGO_SETTINGS_MODULE = "cvat.settings.desktop"
$env:CVAT_BASE_DIR = $tmpData
$env:CVAT_DESKTOP_STATIC_ROOT = "$staging\static"
$env:DJANGO_SECRET_KEY = "build-only"
Push-Location "$staging\backend"
Invoke-Checked "Collecting static files" { & $python manage.py collectstatic --noinput -v 0 }
Pop-Location
Remove-Item -Recurse -Force $tmpData -ErrorAction SilentlyContinue
Remove-Item Env:CVAT_DESKTOP_STATIC_ROOT, Env:CVAT_BASE_DIR, Env:DJANGO_SETTINGS_MODULE, Env:DJANGO_SECRET_KEY

# 5. Pre-migrated database template: the first start copies it instead of running
#    ~140 migrations (see cvat/desktop/init.py)
if (Test-Path "$staging\db-template") { Remove-Item -Recurse -Force "$staging\db-template" }
$tmpData = Join-Path $env:TEMP "cvat-desktop-build-template"
if (Test-Path $tmpData) { Remove-Item -Recurse -Force $tmpData }
$env:DJANGO_SETTINGS_MODULE = "cvat.settings.desktop"
$env:CVAT_BASE_DIR = $tmpData
$env:DJANGO_SECRET_KEY = "build-only"
Push-Location "$staging\backend"
Invoke-Checked "Creating database template" { & $python -m cvat.desktop.init template "$staging\db-template" }
Invoke-Checked "Creating OPA bundle" { & $python -m cvat.desktop.init opa-bundle "$staging\opa-bundle\cvat.tar.gz" }
Pop-Location
Remove-Item -Recurse -Force $tmpData -ErrorAction SilentlyContinue
Remove-Item Env:CVAT_BASE_DIR, Env:DJANGO_SETTINGS_MODULE, Env:DJANGO_SECRET_KEY

# 6. Byte-compile everything. Hash-based pycs stay valid after copying, so the
#    (read-only) install directory is never written at runtime.
Invoke-Checked "Compiling Python files" {
    & $python -m compileall -q -j 0 --invalidation-mode unchecked-hash "$staging\backend" "$staging\python\Lib"
}

# 7. Electron app + installer
Push-Location "$desktop\electron"
if (-not (Test-Path node_modules)) { Invoke-Checked "Installing Electron" { npm install } }
Invoke-Checked "Packaging" { npm run dist }
Pop-Location

Write-Host "Done: $desktop\electron\release"
