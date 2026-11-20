# Keeps the Aniyomi engine alive.
# Third-party extension bytecode can hard-crash the JVM (dex2jar), so the engine
# is supervised: if 127.0.0.1:8790 stops answering, it is started again.
param([int]$Port = 8790, [int]$MangaPort = 4567)

# single instance: a second launch exits at once
$mutex = New-Object System.Threading.Mutex($false, "Global\AniyomiDesktopWatchdog")
if (-not $mutex.WaitOne(0)) { exit }

$root = Split-Path -Parent $PSScriptRoot
$jdk = Join-Path $root "tools\jdk-21.0.13+9\bin\javaw.exe"
$jar = Join-Path $root "app\miwayomi-all.jar"
$data = Join-Path $root "data"
$log = Join-Path $data "watchdog.log"
$mangaJar = Join-Path $root "app\suwayomi.jar"
$mangaData = Join-Path $root "data-manga"

function Test-Port([int]$p = $Port) {
    # TcpClient connect is instant; Get-NetTCPConnection can take seconds on this host
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(700)) { $client.Close(); return $false }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch { return $false }
}

function Stop-StaleEngines {
    Get-CimInstance Win32_Process -Filter "Name='javaw.exe'" |
        Where-Object { $_.CommandLine -like "*miwayomi-all.jar*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

"$(Get-Date -Format s) watchdog started (port $Port)" | Out-File -Append -Encoding utf8 $log
$child = $null
$restarts = 0
while ($true) {
    $alive = $child -and -not $child.HasExited
    if (-not (Test-Port) -and -not $alive) {
        $restarts++
        "$(Get-Date -Format s) engine down, restart #$restarts" | Out-File -Append -Encoding utf8 $log
        # drop leftover crash reports so the folder does not fill up
        Get-ChildItem (Join-Path $root "hs_err_pid*.log") -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } |
            Remove-Item -ErrorAction SilentlyContinue
        Stop-StaleEngines
        try {
            $child = Start-Process -FilePath $jdk -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $data "engine.log") `
                -RedirectStandardError (Join-Path $data "engine.err.log") `
                -ArgumentList @(
                "-Xverify:none"; "-jar"; "$jar"; "--port"; "$Port";
                "--data"; "$data"; "--no-open"; "-f"; '""'
            )
        } catch {
            "$(Get-Date -Format s) spawn failed: $_" | Out-File -Append -Encoding utf8 $log
            $child = $null
            Start-Sleep -Seconds 20
            continue
        }
        "$(Get-Date -Format s) spawned pid $($child.Id)" | Out-File -Append -Encoding utf8 $log
        # wait for the port; never stack a second instance while this one boots
        $waited = 0
        while (-not (Test-Port) -and $waited -lt 300 -and -not $child.HasExited) {
            Start-Sleep -Seconds 2
            $waited += 2
        }
        if ($child.HasExited) {
            "$(Get-Date -Format s) engine exited ($($child.ExitCode)) after ${waited}s" | Out-File -Append -Encoding utf8 $log
        } else {
            "$(Get-Date -Format s) engine up after ${waited}s" | Out-File -Append -Encoding utf8 $log
        }
    }
    if ((Test-Path $mangaJar) -and -not (Test-Port $MangaPort)) {
        $mangaRestarts++
        "$(Get-Date -Format s) manga engine down, restart #$mangaRestarts" | Out-File -Append -Encoding utf8 $log
        try {
            Start-Process -FilePath $jdk -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $data "suwayomi.log") `
                -RedirectStandardError (Join-Path $data "suwayomi.err.log") `
                -ArgumentList @("-jar"; "$mangaJar"; "--server.port=$MangaPort"; "--server.rootDir=$mangaData") | Out-Null
        } catch {
            "$(Get-Date -Format s) manga spawn failed: $_" | Out-File -Append -Encoding utf8 $log
        }
        $waited = 0
        while (-not (Test-Port $MangaPort) -and $waited -lt 300) { Start-Sleep -Seconds 2; $waited += 2 }
        "$(Get-Date -Format s) manga engine up after ${waited}s" | Out-File -Append -Encoding utf8 $log
    }
    Start-Sleep -Seconds 5
}
