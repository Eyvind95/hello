# GalArchive V005 Windows manager. No administrator or credential upload required.
[CmdletBinding()]
param(
    [ValidateSet('Install','Start','Run','Status','Stop','DisableAutostart','EnableAutostart','SelfTest','SelfTestJob')]
    [string]$Action = 'Install',
    [switch]$Reconfigure,
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$base = $PSScriptRoot
$scriptFile = $PSCommandPath
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "GalArchive-Python-v005-$sid"
$homeDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GalArchive-Python-v005'
$python = Join-Path $base '.venv\Scripts\python.exe'
$server = Join-Path $base 'galarchive_mcp_v005.py'
$runtime = Join-Path $base 'tunnel-client-runtime.exe'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$cfgName = 'settings.json'
$statusName = 'status.json'
$stopName = 'stop.json'

function Assert-OrdinaryPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected reparse point in local manager state.' }
    }
}
function Assert-StateAccess {
    Assert-OrdinaryPath $homeDir
    if (-not (Test-Path -LiteralPath $homeDir -PathType Container)) { throw 'Manager is not installed. Run Install first.' }
    # Read the DACL only. Never try to set owner, group or audit information
    # from the limited scheduled-task process.
    $acl = [IO.Directory]::GetAccessControl($homeDir,[Security.AccessControl.AccessControlSections]::Access)
    if (-not $acl.AreAccessRulesProtected) { throw 'Manager state DACL is not protected; repair locally before startup.' }
    $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    $allowed = @($sid,'S-1-5-18')
    foreach ($rule in $rules) {
        if ($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
            throw 'Unexpected manager state ACL; refusing to use credentials.'
        }
    }
    foreach ($id in $allowed) {
        $full = @($rules | Where-Object {
            $_.IdentityReference.Value -eq $id -and
            ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl -and
            ($_.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -and
            ($_.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -and
            $_.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None
        })
        if ($full.Count -eq 0) { throw 'Required manager state access rule missing.' }
    }
}
function Init-State {
    Assert-OrdinaryPath $homeDir
    if (Test-Path -LiteralPath $homeDir) {
        # Reinstall and runtime must not reapply security to an existing
        # protected folder. In particular Set-Acl can require SeRestorePrivilege.
        Assert-StateAccess
        return
    }
    [void](New-Item -ItemType Directory -Path $homeDir)
    Assert-OrdinaryPath $homeDir
    $acl = [IO.Directory]::GetAccessControl($homeDir,[Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))) {
        $acl.RemoveAccessRuleSpecific($rule)
    }
    foreach ($id in @($sid,'S-1-5-18')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($id)),
            'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        [void]$acl.AddAccessRule($rule)
    }
    # Only the modified access-control section is written, not ownership.
    [IO.Directory]::SetAccessControl($homeDir,$acl)
    Assert-StateAccess
}
function Safe-Error($Record) {
    return ('type='+$Record.Exception.GetType().FullName+'; line='+$Record.InvocationInfo.ScriptLineNumber)
}
function Write-State([string]$Name,$Value) {
    $path = Join-Path $homeDir $Name
    Assert-OrdinaryPath $path
    $temp = Join-Path $homeDir ('.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($path)) { [IO.File]::Replace($temp,$path,[System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($temp,$path) }
    } finally {
        if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    }
}
function Read-State([string]$Name) {
    $path = Join-Path $homeDir $Name
    Assert-OrdinaryPath $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Get-Lock {
    $path = Join-Path $homeDir 'manager.lock'
    Assert-OrdinaryPath $path
    try { return [IO.File]::Open($path,'OpenOrCreate','ReadWrite','None') }
    catch [IO.IOException] { return $null }
}
function Get-Backoff([int]$Failures) { return [int][Math]::Min(60, [Math]::Pow(2,[Math]::Min(6,[Math]::Max(1,$Failures)))) }
function Test-StopRequest([string]$Instance) {
    try { $s = Read-State $stopName; return ($null -ne $s -and $s.instance -eq $Instance) }
    catch { return $false }
}
function Test-Owner($State) {
    if ($null -eq $State) { return $false }
    try {
        $proc = Get-Process -Id ([int]$State.pid) -ErrorAction Stop
        return ($proc.StartTime.ToUniversalTime().Ticks.ToString() -eq $State.startTicks)
    } catch { return $false }
}
function Test-PortsFree {
    foreach ($port in @(18766,18767)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $false }
    }
    return (-not (Get-Process -Name 'tunnel-client-runtime' -ErrorAction SilentlyContinue))
}
function Assert-Files {
    foreach ($f in @($python,$server,$runtime)) {
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "Missing required file: $f" }
    }
    $expected = '6053d7bffb8cf227d537cb192c387ce7902ee44a90762c48dd64716d05453a3f'
    if ((Get-FileHash -LiteralPath $server -Algorithm SHA256).Hash -ne $expected) { throw 'Unexpected V005 server SHA-256.' }
}
function Check-Task($task) {
    $expected = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptFile + '" -Action Run'
    if (@($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne $powerShell -or $task.Actions[0].Arguments -ne $expected) {
        throw 'Existing scheduled task is not the expected GalArchive manager; it was not replaced.'
    }
}
function Make-Shortcut([string]$Name,[string]$Mode) {
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    $link = Join-Path $desktop ("GalArchive $Name.lnk")
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($link)
    $sc.TargetPath = $powerShell
    $sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "'+$scriptFile+'" -Action '+$Mode
    $sc.WorkingDirectory = $base
    $sc.WindowStyle = 1
    $sc.Description = 'GalArchive Python V0.0.5 local manager'
    $sc.Save()
}
function Set-Autostart([bool]$Enabled) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Check-Task $task
    $triggers = @()
    if ($Enabled) {
        $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name))
    }
    # Use task definition registration with an explicit trigger set, preserving the action/principal/settings.
    # An empty trigger set means on-demand only.
    $def = New-ScheduledTask -Action $task.Actions -Principal $task.Principal -Settings $task.Settings -Description $task.Description
    if ($Enabled) { $def.Triggers = $triggers }
    if ($task.State -eq 'Running') { throw 'Stop the managed service before changing autostart.' }
    [void](Register-ScheduledTask -TaskName $taskName -InputObject $def -Force)
}
function Install-Manager {
    Assert-Files
    Init-State
    $cfg = Read-State $cfgName
    if ($null -eq $cfg -or $Reconfigure) {
        $archive = $env:GALARCHIVE_ROOT
        if (-not $archive -or -not (Test-Path -LiteralPath $archive -PathType Container)) {
            $archive = Read-Host 'Existing archive root (absolute path)'
        }
        if (-not $archive -or -not (Test-Path -LiteralPath $archive -PathType Container)) { throw 'Archive root not found.' }
        $archive = (Resolve-Path -LiteralPath $archive).ProviderPath
        $tunnel = $env:CONTROL_PLANE_TUNNEL_ID
        if (-not $tunnel) { $tunnel = Read-Host 'Existing tunnel ID' }
        $secret = if ($env:CONTROL_PLANE_API_KEY) {
            ConvertTo-SecureString $env:CONTROL_PLANE_API_KEY -AsPlainText -Force
        } else { Read-Host 'Existing tunnel API key (hidden; saved with Windows DPAPI)' -AsSecureString }
        if (-not $tunnel -or $secret.Length -eq 0) { throw 'Existing tunnel credentials required.' }
        $encrypted = ConvertFrom-SecureString -SecureString $secret
        Write-State $cfgName @{version=1;archiveRoot=$archive;tunnelId=$tunnel;encryptedApiKey=$encrypted}
        $secret.Dispose()
    }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        $taskArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$scriptFile+'" -Action Run'
        $a = New-ScheduledTaskAction -Execute $powerShell -Argument $taskArguments -WorkingDirectory $base
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
        $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        [void](Register-ScheduledTask -TaskName $taskName -Action $a -Trigger $trigger -Principal $principal -Settings $settings -Description 'GalArchive Python local service; current user only')
    } else { Check-Task $existing }
    Make-Shortcut 'Start' 'Start'
    Make-Shortcut 'Status' 'Status'
    Make-Shortcut 'Stop' 'Stop'
    Write-Host 'Installed Start, Status and Stop desktop shortcuts. Login autostart registered for this user.'
    Write-Host 'Credentials are encrypted by Windows DPAPI and stored under LocalAppData, not in Drive.'
    Write-Host 'No old process was stopped. Stop the old launcher normally after active writes finish, then use GalArchive Start.'
}
function Join-ManagerJob {
    if (-not ('GalArchiveManagerJob' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class GalArchiveManagerJob {
    [StructLayout(LayoutKind.Sequential)] struct Basic {
        public long PerProcess, PerJob;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Extended {
        public Basic BasicLimit;
        public Io IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attrs,string name);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended limits,uint size);
    [DllImport("kernel32.dll",SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    private static IntPtr job;
    public static void Join() {
        if(job!=IntPtr.Zero) return;
        IntPtr h=CreateJobObject(IntPtr.Zero,null);
        if(h==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits=new Extended();
        limits.BasicLimit.Flags=0x2000; // kill on close
        if(!SetInformationJobObject(h,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))) ||
           !AssignProcessToJobObject(h,GetCurrentProcess())) {
            int code=Marshal.GetLastWin32Error();
            CloseHandle(h);
            throw new Win32Exception(code,"Cannot create managed process job");
        }
        // The non-inheritable handle stays open for the supervisor's lifetime.
        // On ANY supervisor exit, Windows closes it and terminates its descendants.
        // Do NOT close it while the supervisor is still running.
        job=h;
    }
}
'@
    }
    [GalArchiveManagerJob]::Join()
}
function Start-Owned([string]$File,[string]$CommandLine) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { throw 'Missing child command line.' }
    $info.Arguments = $CommandLine
    $info.WorkingDirectory = $base
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $p = New-Object Diagnostics.Process
    $p.StartInfo = $info
    try {
        if (-not $p.Start()) { throw 'Child did not start.' }
        $p.BeginOutputReadLine()
        $p.BeginErrorReadLine()
        return $p
    } catch {
        $p.Dispose()
        throw
    }
}
function Test-Discovery([string]$Key) {
    try {
        $headers = @{'X-GalArchive-Local-Key'=$Key;Accept='application/json, text/event-stream';'MCP-Protocol-Version'='2025-06-18'}
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18767/mcp' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' -TimeoutSec 3
        $names = @($r.result.tools | ForEach-Object {$_.name})
        return ($names.Count -eq 15 -and 'append_live_turn' -in $names -and 'save_live_image' -in $names -and 'get_live_checkpoint' -in $names -and 'begin_live_generation' -in $names)
    } catch { return $false }
}
function Set-Status([string]$Phase,[string]$Detail,[int]$Failures=0) {
    Write-State $statusName @{instance=$script:instance;pid=$PID;startTicks=$script:startTicks;phase=$Phase;detail=$Detail;
        updatedAt=[DateTimeOffset]::Now.ToString('o');restarts=$Failures;serverPid=$script:serverPid;tunnelPid=$script:tunnelPid;remoteConnection='not-verified'}
}
function Run-Manager {
    Assert-Files
    Assert-StateAccess
    $lock = Get-Lock
    if ($null -eq $lock) { Write-Host 'Manager already running.'; return }
    $script:instance = [guid]::NewGuid().ToString()
    $script:startTicks = (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString()
    $script:serverPid = $null
    $script:tunnelPid = $null
    $failures = 0
    $old = @{}
    $envNames = @('GALARCHIVE_ROOT','CONTROL_PLANE_TUNNEL_ID','CONTROL_PLANE_API_KEY','GALARCHIVE_HTTP_KEY','MCP_COMMAND','MCP_SERVER_URL','MCP_EXTRA_HEADERS','MCP_DISCOVERY_EXTRA_HEADERS')
    foreach ($n in $envNames) { $old[$n] = [Environment]::GetEnvironmentVariable($n,'Process') }
    try {
        Set-Status 'starting' 'Checking local configuration'
        $cfg = Read-State $cfgName
        if ($null -eq $cfg -or $cfg.version -ne 1) { throw 'Run Install first.' }
        $secret = ConvertTo-SecureString $cfg.encryptedApiKey
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secret.Dispose() }
        if (-not $apiKey -or -not $cfg.tunnelId) { throw 'Invalid saved credentials.' }
        Join-ManagerJob
        while (-not (Test-StopRequest $script:instance)) {
            if (-not (Test-Path -LiteralPath $cfg.archiveRoot -PathType Container)) {
                Set-Status 'waiting' 'Archive drive not mounted yet' $failures
                Start-Sleep -Seconds 5
                continue
            }
            if (-not (Test-PortsFree)) {
                Set-Status 'blocked' 'Existing tunnel or occupied port; no unrelated process was stopped' $failures
                Start-Sleep -Seconds 5
                continue
            }
            $child = $null
            $tunnel = $null
            $started = [DateTime]::UtcNow
            try {
                Set-Status 'starting' 'Starting verified V005 local service' $failures
                $env:GALARCHIVE_ROOT = $cfg.archiveRoot
                $env:GALARCHIVE_HTTP_KEY = (& $python -c 'import secrets; print(secrets.token_hex(32))').Trim()
                if ($env:GALARCHIVE_HTTP_KEY -notmatch '^[0-9a-f]{64}$') { throw 'Local key generation failed.' }
                $key = $env:GALARCHIVE_HTTP_KEY
                # The Python child does not need the tunnel API credential.
                Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
                Remove-Item Env:CONTROL_PLANE_TUNNEL_ID -ErrorAction SilentlyContinue
                $child = Start-Owned $python ('"'+$server+'" --http')
                $script:serverPid = $child.Id
                $ready = $false
                for ($i=0; $i -lt 20; $i++) {
                    if ($child.HasExited -or (Test-StopRequest $script:instance)) { break }
                    if (Test-Discovery $key) { $ready = $true; break }
                    Start-Sleep -Milliseconds 500
                }
                if (Test-StopRequest $script:instance) { break }
                if (-not $ready) { throw 'Local discovery failed.' }
                $env:CONTROL_PLANE_TUNNEL_ID = $cfg.tunnelId
                $env:CONTROL_PLANE_API_KEY = $apiKey
                Remove-Item Env:MCP_COMMAND -ErrorAction SilentlyContinue
                $env:MCP_SERVER_URL = 'http://127.0.0.1:18767/mcp'
                $env:MCP_EXTRA_HEADERS = "X-GalArchive-Local-Key: $key"
                $env:MCP_DISCOVERY_EXTRA_HEADERS = $env:MCP_EXTRA_HEADERS
                try { $tunnel = Start-Owned $runtime 'run --health.listen-addr 127.0.0.1:18766' }
                finally { Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue }
                $script:tunnelPid = $tunnel.Id
                Set-Status 'running' 'Local 15-tool discovery passed; tunnel process running (remote not verified)' $failures
                while (-not (Test-StopRequest $script:instance) -and -not $child.HasExited -and -not $tunnel.HasExited) {
                    Start-Sleep -Seconds 5
                    # A busy tool may delay a probe. Report degraded health; do not kill it.
                    if (Test-Discovery $key) { Set-Status 'running' 'Local discovery OK; tunnel process running (remote not verified)' $failures }
                    else { Set-Status 'degraded' 'Local discovery slow/unavailable; child processes still alive' $failures }
                }
                if (-not (Test-StopRequest $script:instance)) {
                    if (([DateTime]::UtcNow-$started).TotalSeconds -ge 120) { $failures=0 }
                    throw 'Owned child exited unexpectedly.'
                }
            } catch {
                $failures++
                Set-Status 'restarting' ('Owned child failed; Task Scheduler retry; '+(Safe-Error $_)) $failures
                throw
            } finally {
                # The job closes on supervisor exit; no unrelated processes are killed.
                if ($null -ne $tunnel) { $tunnel.Dispose() }
                if ($null -ne $child) { $child.Dispose() }
                $script:serverPid = $null
                $script:tunnelPid = $null
                foreach ($name in @('CONTROL_PLANE_API_KEY','GALARCHIVE_HTTP_KEY','MCP_EXTRA_HEADERS','MCP_DISCOVERY_EXTRA_HEADERS')) {
                    Remove-Item ("Env:"+$name) -ErrorAction SilentlyContinue
                }
            }
            break
        }
        Set-Status 'stopped' 'Stopped by user; login autostart remains configured' $failures
    } catch {
        if ($failures -eq 0) { Set-Status 'error' ('Configuration or manager failure; '+(Safe-Error $_)) $failures }
        throw 'GalArchive manager failed. No credentials included in this error.'
    } finally {
        foreach ($n in $old.Keys) { [Environment]::SetEnvironmentVariable($n,$old[$n],'Process') }
        $lock.Dispose()
    }
}
function Self-Test {
    $original = $homeDir
    $script:homeDir = Join-Path ([IO.Path]::GetTempPath()) ('galarchive-manager-test-'+[guid]::NewGuid().ToString('N'))
    try {
        Init-State
        $before = [IO.Directory]::GetAccessControl($homeDir,[Security.AccessControl.AccessControlSections]::Access).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
        Init-State
        Assert-StateAccess
        $after = [IO.Directory]::GetAccessControl($homeDir,[Security.AccessControl.AccessControlSections]::Access).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
        if ($before -ne $after) { throw 'Existing state ACL unexpectedly changed' }
        $s = ConvertTo-SecureString 'synthetic-secret' -AsPlainText -Force
        $e = ConvertFrom-SecureString $s
        if ($e -match 'synthetic-secret') { throw 'DPAPI plaintext leak' }
        $r = ConvertTo-SecureString $e
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($r)
        try { if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -ne 'synthetic-secret') { throw 'DPAPI mismatch' } }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $s.Dispose(); $r.Dispose() }
        Write-State $cfgName @{version=1;encryptedApiKey=$e}
        if ((Read-State $cfgName).encryptedApiKey -ne $e) { throw 'State readback mismatch' }
        Write-State $cfgName @{version=1;encryptedApiKey=$e;test=2}
        if ((Read-State $cfgName).test -ne 2) { throw 'State replace mismatch' }
        $lock=Get-Lock
        if ($null -eq $lock) { throw 'Initial lock failed' }
        try { if ($null -ne (Get-Lock)) { throw 'Duplicate lock accepted' } } finally { $lock.Dispose() }
        $again=Get-Lock; if ($null -eq $again) { throw 'Lock not released' }; $again.Dispose()
        Write-State $stopName @{instance='a'}
        if (-not (Test-StopRequest 'a') -or (Test-StopRequest 'b')) { throw 'Stop instance isolation failed' }
        if ((Get-Backoff 1) -ne 2 -or (Get-Backoff 30) -ne 60) { throw 'Backoff failed' }
        if (-not (Test-Owner @{pid=$PID;startTicks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString()})) { throw 'Process identity check failed' }
        if (Test-Owner @{pid=$PID;startTicks='0'}) { throw 'PID reuse guard failed' }
        $pidFile = Join-Path $script:homeDir 'descendant.pid'
        $oldTestDir = $env:GALARCHIVE_MANAGER_TEST_DIR
        $env:GALARCHIVE_MANAGER_TEST_DIR = $script:homeDir
        $p=$null
        $desc=$null
        try {
            $p=Start-Owned $powerShell ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptFile+'" -Action SelfTestJob -NoPause')
            for ($i=0;$i -lt 100 -and -not (Test-Path -LiteralPath $pidFile) -and -not $p.HasExited;$i++) { Start-Sleep -Milliseconds 200 }
            if (-not (Test-Path -LiteralPath $pidFile)) {
                $why = Join-Path $script:homeDir 'job-error.txt'
                if (Test-Path -LiteralPath $why) { throw ('Job child: '+(Get-Content -LiteralPath $why -Raw)) }
                throw ('Owned job child did not start; exit status: '+$(if($p.HasExited){$p.ExitCode}else{'still-running'}))
            }
            $desc=Get-Process -Id ([int](Get-Content -LiteralPath $pidFile -Raw)) -ErrorAction Stop
            [IO.File]::WriteAllText((Join-Path $script:homeDir 'job-exit.txt'),'exit')
            if (-not $p.WaitForExit(15000) -or $p.ExitCode -ne 0) { throw 'Synthetic job supervisor did not exit normally' }
            if (-not $desc.WaitForExit(10000)) { throw 'Owned descendant was not terminated by job close' }
        } finally {
            if ($null -ne $p) {
                if (-not $p.HasExited) { $p.Kill(); [void]$p.WaitForExit(10000) }
                $p.Dispose()
            }
            if ($null -ne $desc) { $desc.Dispose() }
            $env:GALARCHIVE_MANAGER_TEST_DIR = $oldTestDir
        }
        Write-Host 'GalArchive manager self-test PASS (DPAPI, atomic state, lock, stop token, backoff, owned process-tree cleanup).'
    } finally {
        Remove-Item -LiteralPath $script:homeDir -Recurse -Force
        $script:homeDir=$original
    }
}
try {
    switch ($Action) {
        'Install' { Install-Manager }
        'Start' {
            $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
            Check-Task $task
            if ($task.State -eq 'Running') { Write-Host 'Already running; use GalArchive Status.' }
            else { Start-ScheduledTask -TaskName $taskName; Write-Host 'Start requested; use GalArchive Status to verify.' }
        }
        'Run' { Run-Manager }
        'Status' {
            $s=Read-State $statusName
            if (Test-Owner $s) { $s | Format-List | Out-Host }
            else { Write-Host 'Managed service is not running (or status is stale).'; if ($null -ne $s) { Write-Host 'Last recorded status (not a live process):'; $s | Format-List | Out-Host }; if (-not (Test-PortsFree)) { Write-Host 'Another tunnel or listener exists; no process was stopped.' } }
            $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($null -ne $task) { Write-Host ('Scheduled task: '+$task.State+'; login triggers: '+@($task.Triggers).Count); $info=Get-ScheduledTaskInfo -TaskName $taskName; Write-Host ('Last task result: '+$info.LastTaskResult+'; last run: '+$info.LastRunTime) }
        }
        'Stop' {
            $s=Read-State $statusName
            if (Test-Owner $s) { Write-State $stopName @{instance=$s.instance}; Write-Host 'Stop requested. Check Status. Only owned service processes will stop.' }
            else { Write-Host 'Managed service is not running. No unrelated process was stopped.' }
        }
        'DisableAutostart' { Set-Autostart $false; Write-Host 'Login autostart disabled; desktop Start remains available.' }
        'EnableAutostart' { Set-Autostart $true; Write-Host 'Login autostart enabled.' }
        'SelfTestJob' {
            # Isolated synthetic supervisor, no production state or credentials.
            $dir=$env:GALARCHIVE_MANAGER_TEST_DIR
            if (-not $dir -or -not (Test-Path -LiteralPath $dir -PathType Container) -or
                (Split-Path -Leaf $dir) -notmatch '^galarchive-manager-test-[a-f0-9]{32}$') { throw 'Invalid synthetic test directory' }
            try {
                Join-ManagerJob
                $testPython = if (Test-Path -LiteralPath $python -PathType Leaf) { $python } else { (Get-Command python.exe -ErrorAction Stop).Source }
                $child = Start-Owned $testPython '-c "import time; time.sleep(60)"'
                [IO.File]::WriteAllText((Join-Path $dir 'descendant.pid'),$child.Id.ToString())
                for ($i=0;$i -lt 150 -and -not (Test-Path -LiteralPath (Join-Path $dir 'job-exit.txt'));$i++) { Start-Sleep -Milliseconds 200 }
                $child.Dispose()
                exit 0
            } catch {
                [IO.File]::WriteAllText((Join-Path $dir 'job-error.txt'),$_.Exception.Message)
                exit 1
            }
        }
        'SelfTest' { Self-Test }
    }
} catch {
    if ($Action -eq 'Run') { [Console]::Error.WriteLine((Safe-Error $_)); exit 1 }
    Write-Error -ErrorAction Continue ('GalArchive manager: '+$_.Exception.Message)
    if (-not $NoPause) { [void](Read-Host 'Press Enter to close') }
    exit 1
}
if (-not $NoPause -and $Action -notin @('Run','SelfTest','SelfTestJob')) { [void](Read-Host 'Press Enter to close') }
