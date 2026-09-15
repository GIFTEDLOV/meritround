[CmdletBinding()]
param(
    [ValidateSet("bradbury", "studionet", "studio-dev")]
    [string]$Network = "bradbury",
    [int]$BlockPollSeconds = 5
)

# V2 read-only health probe. This script never signs, broadcasts, estimates a
# transaction, or falls back between networks. The legacy bradbury_preflight.ps1
# remains historical V1 evidence and is not a V2 deployment gate.

$ErrorActionPreference = "Stop"

$networkConfig = switch ($Network) {
    "bradbury" {
        [ordered]@{
            cli = "testnet-bradbury"
            rpc = "https://rpc-bradbury.genlayer.com"
            chain_id = 4221
        }
    }
    "studionet" {
        [ordered]@{
            cli = "studionet"
            rpc = "https://studio.genlayer.com/api"
            chain_id = 61999
        }
    }
    "studio-dev" {
        [ordered]@{
            cli = "studio-dev"
            rpc = "https://studio-dev.genlayer.com/api"
            chain_id = 61997
        }
    }
}

function Invoke-JsonRpc {
    param(
        [Parameter(Mandatory = $true)][string]$Rpc,
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

$firstBlock = $null
$secondBlock = $null
$chainId = $null
$rpcError = $null
$blocksAdvancing = $false

try {
    $chainId = Convert-HexToInt64 (Invoke-JsonRpc $networkConfig.rpc "eth_chainId" @())
    $firstBlock = Convert-HexToInt64 (Invoke-JsonRpc $networkConfig.rpc "eth_blockNumber" @())
    if ($BlockPollSeconds -gt 0) {
        Start-Sleep -Seconds $BlockPollSeconds
    }
    $secondBlock = Convert-HexToInt64 (Invoke-JsonRpc $networkConfig.rpc "eth_blockNumber" @())
    $blocksAdvancing = $secondBlock -gt $firstBlock
}
catch {
    $rpcError = $_.Exception.Message
}

$report = [ordered]@{
    mode = "READ_ONLY_V2_NETWORK_PREFLIGHT"
    network = $Network
    cli_network = $networkConfig.cli
    rpc = $networkConfig.rpc
    expected_chain_id = $networkConfig.chain_id
    observed_chain_id = $chainId
    first_block = $firstBlock
    second_block = $secondBlock
    blocks_advancing = $blocksAdvancing
    rpc_error = $rpcError
    transaction_sent = $false
}

$report | ConvertTo-Json -Depth 6
if ($null -ne $rpcError -or $chainId -ne $networkConfig.chain_id -or -not $blocksAdvancing) {
    exit 1
}
