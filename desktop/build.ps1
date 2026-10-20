# Builds the CVAT desktop app for Windows.
# Output: desktop/electron/release/CVATDesktop-Setup-<version>.exe (installer) and a zip.
#
# Requirements: Node.js + corepack (yarn), the development venv (.venv, see desktop/README.md)
# which provides uv and the standalone Python 3.12 it was created from.
#
# Usage: powershell -ExecutionPolicy Bypass -File desktop/build.ps1 [-Target <all|dir|zip|nsis>]
#            [-SkipUI] [-SkipPython] [-Clean] [-Output <dir>]
#   -Target: what to produce (default: all = installer + zip). "dir" only creates the unpacked
#            app in <output>\win-unpacked, which is the fastest way to try a change.
#   -Clean:  rebuild the Python runtime, static files and database template even if their
#            inputs did not change (they are reused otherwise, see staging\*.stamp)
#   -Output: directory inside desktop/electron for the results (default: release)
param(
    [switch]$SkipUI,
    [switch]$SkipPython,
    [switch]$Clean,
    [ValidateSet("all", "dir", "zip", "nsis")][string]$Target = "all",
    [string]$Output = "release"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = $PSScriptRoot
$staging = Join-Path $desktop "staging"
$uv = Join-Path $root ".venv\Scripts\uv.exe"
$buildTimer = [Diagnostics.Stopwatch]::StartNew()

# Packaging recreates <output>\win-unpacked. An app started from there runs in portable mode
# and keeps its database and videos in win-unpacked\data, which must not be deleted silently.
$unpackedData = Join-Path $desktop "electron\$Output\win-unpacked\data"
if (Test-Path $unpackedData) {
    throw "$unpackedData contains application data that packaging would delete. " +
        "Move this folder to a safe place first, or build into another directory with -Output <dir>."
}

function Write-Step([string]$what) {
    Write-Host ("==> [{0:mm\:ss}] {1}" -f $buildTimer.Elapsed, $what)
}

function Invoke-Checked([string]$what, [scriptblock]$block) {
    Write-Step $what
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

# Hash of the contents of the given files; patterns may contain wildcards and directories
# are hashed recursively. Used to skip build steps whose inputs did not change.
function Get-InputsHash([string[]]$patterns) {
    $lines = foreach ($pattern in $patterns) {
        $items = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
        $files = foreach ($item in $items) {
            if ($item.PSIsContainer) {
                Get-ChildItem $item.FullName -Recurse -File | Where-Object { $_.FullName -notmatch '\\__pycache__\\' }
            } else { $item }
        }
        foreach ($file in ($files | Sort-Object FullName)) {
            "$($file.FullName.Substring($root.Length)) $((Get-FileHash $file.FullName -Algorithm SHA256).Hash)"
        }
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    $sha = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "")
}

# A stamp file records the inputs hash of a finished step. It is removed before the step
# starts, so a failed or interrupted step is always repeated.
function Test-Stamp([string]$name, [string]$key) {
    $file = Join-Path $staging "$name.stamp"
    return (-not $Clean) -and (Test-Path $file) -and ((Get-Content $file -Raw).Trim() -eq $key)
}
function Remove-Stamp([string]$name) {
    Remove-Item -Force (Join-Path $staging "$name.stamp") -ErrorAction SilentlyContinue
}
function Set-Stamp([string]$name, [string]$key) {
    Set-Content -Path (Join-Path $staging "$name.stamp") -Value $key -NoNewline
}

& "$desktop\fetch-vendor.ps1"
New-Item -ItemType Directory -Force $staging | Out-Null

# 1. UI (desktop mode hides features that need extra services)
if (-not $SkipUI) {
    Push-Location "$root\cvat-ui"
    # webpack does not remove bundles of previous builds, they would be packaged too
    # (favicon.ico is a tracked file that webpack does not generate)
    if (Test-Path dist) {
        Get-ChildItem dist -Exclude favicon.ico | Remove-Item -Recurse -Force
    }
    $env:CVAT_DESKTOP = "true"
    $env:SOURCE_MAPS_ENABLED = "false"
    Invoke-Checked "Building UI" { node ..\node_modules\webpack-cli\bin\cli.js --config ./webpack.config.js }
    Pop-Location
}

# 2. Python runtime: relocatable standalone CPython + all backend dependencies.
#    It only changes with the requirements, so it is reused while they stay the same.
$python = Join-Path $staging "python\python.exe"
$venvCfg = Get-Content "$root\.venv\pyvenv.cfg" | Where-Object { $_ -match '^home\s*=' }
$pythonHome = ($venvCfg -split '=', 2)[1].Trim()
# dependencies of datumaro are part of requirements-windows.txt; --no-deps keeps the
# headless OpenCV build instead of pulling opencv-python
$wheel = Get-ChildItem "$desktop\wheels\datumaro-*-cp312-*win_amd64.whl" | Select-Object -First 1
$pythonKey = (Get-InputsHash @("$desktop\requirements-windows.txt", $wheel.FullName)) + " " + $pythonHome
if ($SkipPython) {
    Write-Step "Skipping the Python runtime (-SkipPython)"
} elseif ((Test-Stamp "python" $pythonKey) -and (Test-Path $python)) {
    Write-Step "Python runtime is up to date"
} else {
    Remove-Stamp "python"
    if (Test-Path "$staging\python") { Remove-Item -Recurse -Force "$staging\python" }
    Write-Step "Copying Python from $pythonHome"
    robocopy $pythonHome "$staging\python" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ | Out-Null
    Remove-Item -Force "$staging\python\Lib\EXTERNALLY-MANAGED" -ErrorAction SilentlyContinue

    Invoke-Checked "Installing backend dependencies" {
        & $uv pip install --python $python --break-system-packages -r "$desktop\requirements-windows.txt"
    }
    Invoke-Checked "Installing datumaro" {
        & $uv pip install --python $python --break-system-packages --no-deps $wheel.FullName
    }
    # Byte-compile before anything imports the packages. Hash-based pycs stay valid after
    # copying, so the (read-only) install directory is never written at runtime.
    Invoke-Checked "Compiling the Python runtime" {
        & $python -m compileall -q -j 0 --invalidation-mode unchecked-hash "$staging\python\Lib"
    }
    Set-Stamp "python" $pythonKey
}

# 3. Backend sources
Write-Step "Copying backend sources"
if (Test-Path "$staging\backend") { Remove-Item -Recurse -Force "$staging\backend" }
robocopy "$root\cvat" "$staging\backend\cvat" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ tests requirements | Out-Null
robocopy "$root\utils\dataset_manifest" "$staging\backend\utils\dataset_manifest" /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ | Out-Null
Copy-Item "$root\utils\__init__.py" "$staging\backend\utils\"
Copy-Item "$root\manage.py", "$root\rqscheduler.py" "$staging\backend\"

# 4. Static files (Django admin/DRF assets, logo): they come from the installed packages
#    and the static directories of the CVAT apps
$settingsHash = Get-InputsHash @("$root\cvat\settings\*.py")
$staticKey = $pythonKey + " " + $settingsHash + " " + (Get-InputsHash @("$root\cvat\apps\*\static"))
if ((Test-Stamp "static" $staticKey) -and (Test-Path "$staging\static")) {
    Write-Step "Static files are up to date"
} else {
    Remove-Stamp "static"
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
    Set-Stamp "static" $staticKey
}

# 5. Pre-migrated database template: the first start copies it instead of running
#    ~140 migrations (see cvat/desktop/init.py), and the OPA bundle with the permission rules.
#    Both are rebuilt only when migrations, permission rules or dependencies change.
$templateKey = $pythonKey + " " + $settingsHash + " " + (Get-InputsHash @(
    "$root\cvat\apps\*\migrations\*.py",
    "$root\cvat\apps\*\rules\*.rego",
    "$root\cvat\apps\iam\utils.py",
    "$root\cvat\desktop\init.py"
))
if ((Test-Stamp "db-template" $templateKey) -and (Test-Path "$staging\db-template") -and
        (Test-Path "$staging\opa-bundle\cvat.tar.gz")) {
    Write-Step "Database template and OPA bundle are up to date"
} else {
    Remove-Stamp "db-template"
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
    Set-Stamp "db-template" $templateKey
}

# 6. Byte-compile the backend (-f: the steps above imported it and left timestamp-based pycs)
Invoke-Checked "Compiling backend sources" {
    & $python -m compileall -q -f -j 0 --invalidation-mode unchecked-hash "$staging\backend"
}

# 7. Electron app, then the installer and the zip. Both archives are made from the same
#    unpacked app in parallel: each archiver alone uses only a few CPU cores.
Push-Location "$desktop\electron"
if (-not (Test-Path node_modules)) { Invoke-Checked "Installing Electron" { npm install } }
$builder = "node_modules\electron-builder\cli.js"
$outputArg = "-c.directories.output=$Output"
Invoke-Checked "Packaging the app" { node $builder --win --dir $outputArg }

$targets = switch ($Target) {
    "all" { @("nsis", "zip") }
    "dir" { @() }
    default { @($Target) }
}
if ($targets.Count -gt 0) {
    Write-Step "Building $($targets -join ' and ')"
    $unpacked = Join-Path $Output "win-unpacked"
    $jobs = foreach ($t in $targets) {
        $log = Join-Path $Output "build-$t.log"
        # 7-Zip makes zips with Deflate level 7 by default (3 passes); level 5 is about 3 times
        # faster and the zip only grows by 1-2 %. The installer keeps its default compression.
        if ($t -eq "zip") { $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = "5" }
        $process = Start-Process node -NoNewWindow -PassThru -WorkingDirectory "$desktop\electron" `
            -RedirectStandardOutput $log `
            -RedirectStandardError "$log.err" `
            -ArgumentList @($builder, "--win", $t, "--prepackaged", "`"$unpacked`"", "`"$outputArg`"")
        $null = $process.Handle  # keeps the exit code available after the process ends
        Remove-Item Env:ELECTRON_BUILDER_COMPRESSION_LEVEL -ErrorAction SilentlyContinue
        [pscustomobject]@{ Target = $t; Process = $process; Log = $log }
    }
    $failed = @()
    foreach ($job in $jobs) {
        $job.Process.WaitForExit()
        if ($job.Process.ExitCode -ne 0) {
            Get-Content $job.Log, "$($job.Log).err" -ErrorAction SilentlyContinue | Write-Host
            $failed += $job.Target
        }
        Remove-Item -Force $job.Log, "$($job.Log).err" -ErrorAction SilentlyContinue
    }
    if ($failed.Count -gt 0) { throw "Building $($failed -join ', ') failed" }
}
Pop-Location

Write-Step "Done: $desktop\electron\$Output"
