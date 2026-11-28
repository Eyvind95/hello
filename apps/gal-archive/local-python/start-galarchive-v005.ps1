# Run from existing tunnel-client runtime folder, after all callers have saved.
# Does not download or replace files, kill other processes, or rotate tunnel keys.
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot
$python = Join-Path $base '.venv\Scripts\python.exe'
$server = Join-Path $base 'galarchive_mcp_v005.py'
$runtime = Join-Path $base 'tunnel-client-runtime.exe'
foreach ($f in @($python,$server,$runtime)) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "Missing required local file: $f" }
}
if (Get-Process -Name 'tunnel-client-runtime' -ErrorAction SilentlyContinue) {
    throw 'An existing tunnel runtime is active. Preserve all work and stop it normally before cutover.'
}
foreach ($port in @(18766,18767)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. No process has been stopped."
    }
}
if (-not $env:GALARCHIVE_ROOT -or -not (Test-Path -LiteralPath $env:GALARCHIVE_ROOT -PathType Container)) {
    $env:GALARCHIVE_ROOT = Read-Host 'Existing archive root (absolute path)'
    if (-not (Test-Path -LiteralPath $env:GALARCHIVE_ROOT -PathType Container)) { throw 'Archive root not found' }
}
& $python $server --self-test
if ($LASTEXITCODE -ne 0) { throw 'Synthetic self-test failed' }
$helpText = (& $runtime run --help 2>&1 | Out-String)
if ($helpText -notmatch 'mcp\.server-url' -or $helpText -notmatch 'mcp\.extra-headers' -or
    $helpText -notmatch 'mcp\.discovery-extra-headers') { throw 'Runtime does not advertise required HTTP configuration' }
if (-not $env:CONTROL_PLANE_TUNNEL_ID) {
    $env:CONTROL_PLANE_TUNNEL_ID = Read-Host 'Existing tunnel ID'
}
if (-not $env:CONTROL_PLANE_API_KEY) {
    $secret = Read-Host 'Existing tunnel API key (hidden)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not $env:CONTROL_PLANE_TUNNEL_ID -or -not $env:CONTROL_PLANE_API_KEY) { throw 'Existing tunnel credentials required' }
$oldConfig = @{}
foreach ($name in @('MCP_COMMAND','MCP_SERVER_URL','MCP_EXTRA_HEADERS','MCP_DISCOVERY_EXTRA_HEADERS','GALARCHIVE_HTTP_KEY')) {
    $oldConfig[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
}
$child = $null
try {
    $env:GALARCHIVE_HTTP_KEY = (& $python -c 'import secrets; print(secrets.token_hex(32))').Trim()
    if ($env:GALARCHIVE_HTTP_KEY -notmatch '^[0-9a-f]{64}$') { throw 'Failed to generate local credential' }
    $child = Start-Process -FilePath $python -ArgumentList ('"{0}" --http' -f $server) -WorkingDirectory $base -PassThru -NoNewWindow
    $headers = @{
        'X-GalArchive-Local-Key' = $env:GALARCHIVE_HTTP_KEY
        'Accept' = 'application/json, text/event-stream'
        'MCP-Protocol-Version' = '2025-06-18'
    }
    $body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
    $ready = $false
    for ($i=0; $i -lt 20; $i++) {
        if ($child.HasExited) { throw 'Local HTTP server exited' }
        try {
            $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18767/mcp' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 2
            $names = @($r.result.tools | ForEach-Object { $_.name })
            if ($names.Count -eq 15 -and 'append_live_turn' -in $names -and
                'begin_live_generation' -in $names -and 'get_live_checkpoint' -in $names -and
                'save_live_image' -in $names) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Local HTTP tool discovery failed; tunnel not started' }
    Write-Host 'V0.0.5 local HTTP discovery passed (15 tools). Starting existing tunnel.'
    Remove-Item Env:MCP_COMMAND -ErrorAction SilentlyContinue
    $env:MCP_SERVER_URL = 'http://127.0.0.1:18767/mcp'
    $env:MCP_EXTRA_HEADERS = "X-GalArchive-Local-Key: $env:GALARCHIVE_HTTP_KEY"
    $env:MCP_DISCOVERY_EXTRA_HEADERS = $env:MCP_EXTRA_HEADERS
    & $runtime run --health.listen-addr 127.0.0.1:18766
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel runtime returned an error' }
} finally {
    if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
    foreach ($name in $oldConfig.Keys) {
        [Environment]::SetEnvironmentVariable($name,$oldConfig[$name],'Process')
    }
}
