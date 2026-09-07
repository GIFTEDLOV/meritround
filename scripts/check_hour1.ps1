$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$lintCommand = Get-Command genvm-lint.exe -ErrorAction SilentlyContinue
$lint = if ($null -ne $lintCommand) {
    $lintCommand.Source
} else {
    Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\Scripts\genvm-lint.exe"
}

if (-not (Test-Path -LiteralPath $lint)) {
    throw "genvm-lint was not found. Install the current GenLayer tooling first."
}

python -m pytest -q
& $lint check contracts/meritround.py --json
