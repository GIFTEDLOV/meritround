[CmdletBinding()]
param(
    [string]$Rpc = "https://rpc-bradbury.genlayer.com",
    [int]$ExpectedChainId = 4221,
    [string]$ExpectedSourceSha256 = "14bb755eb33ee3a7ae81c41eb0f7a94d371c6d980759b2d6669760021f0d86c7",
    [string]$DeployerAddress = $env:GENLAYER_DEPLOYER_ADDRESS
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$contractPath = Join-Path $repoRoot "contracts\meritround.py"

function Invoke-JsonRpc {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Params
    )

    $request = @{
        jsonrpc = "2.0"
        id = 1
        method = $Method
        params = $Params
    } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Uri $Rpc -Method Post -ContentType "application/json" -Body $request
    if ($null -ne $response.error) {
        throw "$Method failed: $($response.error.message)"
    }
    return $response.result
}

function Convert-HexToInt64 {
    param([Parameter(Mandatory = $true)][string]$Value)
    return [Convert]::ToInt64($Value.Substring(2), 16)
}

if (-not $DeployerAddress) {
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $accountOutput = (& genlayer account show --rpc $Rpc 2>&1 | Out-String)
    $ErrorActionPreference = $savedErrorActionPreference
    $addressMatch = [regex]::Match($accountOutput, "0x[0-9a-fA-F]{40}")
    if ($addressMatch.Success) {
        $DeployerAddress = $addressMatch.Value
    }
}

$addressValid = $DeployerAddress -match "^0x[0-9a-fA-F]{40}$"
$sourceSha256 = (Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceMatches = $sourceSha256 -eq $ExpectedSourceSha256.ToLowerInvariant()
$rpcHealthy = $false
$chainId = $null
$latestBlock = $null
$balance = $null
$latestNonce = $null
$pendingNonce = $null
$pendingRisk = $null
$rpcError = $null

try {
    $chainId = Convert-HexToInt64 (Invoke-JsonRpc "eth_chainId" @())
    $latestBlock = Invoke-JsonRpc "eth_blockNumber" @()
    if ($addressValid) {
        $balance = Invoke-JsonRpc "eth_getBalance" @($DeployerAddress, "latest")
        $latestNonce = Convert-HexToInt64 (Invoke-JsonRpc "eth_getTransactionCount" @($DeployerAddress, "latest"))
        $pendingNonce = Convert-HexToInt64 (Invoke-JsonRpc "eth_getTransactionCount" @($DeployerAddress, "pending"))
        $pendingRisk = $pendingNonce -gt $latestNonce
    }
    $rpcHealthy = $chainId -eq $ExpectedChainId -and $null -ne $latestBlock
}
catch {
    $rpcError = $_.Exception.Message
}

$cliHelp = (& genlayer --help 2>&1 | Out-String)
$feeEstimateAvailable = $cliHelp -match "estimate-fees"
$feeRequirementStatus = if ($feeEstimateAvailable) {
    "UNVERIFIED: estimate-fees command exists; run the compatible measured quote before signing."
} else {
    "BLOCKED: current stable CLI exposes no estimate-fees command or fee distribution path."
}

$gate = [ordered]@{
    wrong_chain = $chainId -ne $ExpectedChainId
    unhealthy_rpc = -not $rpcHealthy
    deployer_address_unavailable = -not $addressValid
    pending_nonce_risk = [bool]$pendingRisk
    fee_requirement_undetermined = -not $feeEstimateAvailable
    source_hash_mismatch = -not $sourceMatches
}
$ready = $gate.Values -notcontains $true

$report = [ordered]@{
    mode = "READ_ONLY_BRADBURY_PREFLIGHT"
    rpc = $Rpc
    expected_chain_id = $ExpectedChainId
    observed_chain_id = $chainId
    rpc_healthy = $rpcHealthy
    latest_block = $latestBlock
    deployer_address = if ($addressValid) { $DeployerAddress.ToLowerInvariant() } else { $null }
    balance_hex = $balance
    latest_nonce = $latestNonce
    pending_nonce = $pendingNonce
    unexpected_pending_transaction_risk = $pendingRisk
    source_path = $contractPath
    source_sha256 = $sourceSha256
    expected_source_sha256 = $ExpectedSourceSha256.ToLowerInvariant()
    source_hash_matches_release = $sourceMatches
    fee_estimate_available = $feeEstimateAvailable
    fee_requirement_status = $feeRequirementStatus
    rpc_error = $rpcError
    release_gate = $gate
    ready_for_bradbury_signing = $ready
    transaction_sent = $false
}

$report | ConvertTo-Json -Depth 6
if (-not $ready) {
    exit 1
}
