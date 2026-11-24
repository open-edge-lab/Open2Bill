#Requires -Version 5.1
<#
.SYNOPSIS
  Pannello di controllo di Open2Bill per Windows: avvio, arresto, stato e compilazione dell'exe.

.DESCRIPTION
  Senza parametri apre un menu interattivo. Gli stessi comandi si usano anche da riga di comando:

    .\open2bill.ps1                      menu interattivo
    .\open2bill.ps1 start dev            sviluppo: API + UI sui dati reali
    .\open2bill.ps1 start example        sviluppo sui dati fittizi di esempio
    .\open2bill.ps1 start desktop        app desktop (Electron)
    .\open2bill.ps1 start server         server con la build di produzione, sui dati reali
    .\open2bill.ps1 stop                 ferma i servizi avviati da questo script
    .\open2bill.ps1 stop -Force          ferma ogni processo di Open2Bill, anche orfano o avviato altrove
    .\open2bill.ps1 status               stato dettagliato
    .\open2bill.ps1 logs dev             ultime righe del log di un servizio
    .\open2bill.ps1 build                compila l'installer Windows (.exe)

  -Yes salta le richieste di conferma.

  I servizi girano in background in un cmd.exe senza finestra: chiudere il terminale non li ferma.
  PID e log stanno in %TEMP%\open2bill-run, fuori dal repository, perché i log possono contenere
  nomi di clienti e percorsi della cartella dati.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('menu', 'start', 'stop', 'status', 'logs', 'build')]
  [string]$Command = 'menu',

  [Parameter(Position = 1)]
  [ValidateSet('dev', 'example', 'desktop', 'server')]
  [string]$Target,

  [switch]$Force,

  [switch]$Yes
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ─── Percorsi e servizi ────────────────────────────────────────────────────────

$Root = $PSScriptRoot
$RootSlash = $Root -replace '\\', '/'
$RunDir = Join-Path $env:TEMP 'open2bill-run'
$ReleaseDir = Join-Path $Root 'apps\desktop\release'
$ExampleDataDir = Join-Path $env:TEMP 'open2bill-example-data'
$Interactive = $Command -eq 'menu'

# Ogni servizio gira in un cmd.exe senza finestra, con tutto l'output nel proprio log.
$Services = [ordered]@{
  dev     = @{
    Label   = 'Sviluppo sui dati reali'
    Hint    = 'API + UI con ricarica automatica'
    Npm     = 'npm run dev'
    Ports   = @(3210, 5273)
    Checks  = @('http://127.0.0.1:3210/api/health', 'http://localhost:5273/')
    Url     = 'http://localhost:5273/'
    Window  = $false
    Timeout = 120
  }
  example = @{
    Label   = 'Sviluppo sui dati di esempio'
    Hint    = 'copia temporanea dei dati fittizi'
    Npm     = 'npm run dev:example'
    Ports   = @(3210, 5273)
    Checks  = @('http://127.0.0.1:3210/api/health', 'http://localhost:5273/')
    Url     = 'http://localhost:5273/'
    Window  = $false
    Timeout = 120
  }
  desktop = @{
    Label   = 'App desktop (Electron)'
    Hint    = 'compila la UI e apre la finestra'
    Npm     = 'npm run desktop'
    Ports   = @()
    Checks  = @()
    Url     = $null
    Window  = $true
    Timeout = 300
  }
  server  = @{
    Label   = 'Server con la build di produzione'
    Hint    = 'compila e serve UI + API su :3210, dati reali'
    Npm     = 'npm run build && npm start'
    Ports   = @(3210)
    Checks  = @('http://127.0.0.1:3210/api/health')
    Url     = 'http://localhost:3210/'
    Window  = $false
    Timeout = 300
  }
}

$KnownPorts = @(
  [pscustomobject]@{ Port = 3210; Label = 'API (Fastify)' }
  [pscustomobject]@{ Port = 5273; Label = 'UI di sviluppo (Vite)' }
  [pscustomobject]@{ Port = 3299; Label = 'server dei test e2e' }
)

# Processi che, se lanciati dal repository, appartengono sicuramente a Open2Bill
$RepoProcessNames = @('node.exe', 'electron.exe', 'esbuild.exe')

# ─── Output ────────────────────────────────────────────────────────────────────

function Write-O2bTitle([string]$Text) {
  Write-Host ''
  Write-Host "  $Text" -ForegroundColor Cyan
  Write-Host ''
}
function Write-O2bInfo([string]$Text) { Write-Host "  $Text" -ForegroundColor Gray }
function Write-O2bOk([string]$Text) { Write-Host "  $Text" -ForegroundColor Green }
function Write-O2bWarn([string]$Text) { Write-Host "  $Text" -ForegroundColor Yellow }
function Write-O2bError([string]$Text) { Write-Host "  $Text" -ForegroundColor Red }

function Write-O2bRow([string]$Label, [string]$Value, [ConsoleColor]$Color = 'Gray') {
  Write-Host ('  {0,-16}' -f $Label) -NoNewline -ForegroundColor DarkGray
  Write-Host $Value -ForegroundColor $Color
}

function Format-O2bDuration([TimeSpan]$Span) {
  if ($Span.TotalMinutes -lt 1) { return '{0} s' -f [int][Math]::Floor($Span.TotalSeconds) }
  if ($Span.TotalHours -lt 1) { return '{0} min' -f [int][Math]::Floor($Span.TotalMinutes) }
  return '{0} h {1:00} min' -f [int][Math]::Floor($Span.TotalHours), $Span.Minutes
}

function Format-O2bCommandLine([string]$Text) {
  if (-not $Text) { return '' }
  $short = $Text -replace [regex]::Escape($Root + '\'), '' -replace [regex]::Escape($RootSlash + '/'), ''
  $short = ($short -replace '\s+', ' ').Trim()
  if ($short.Length -gt 110) { $short = $short.Substring(0, 107) + '...' }
  return $short
}

function Confirm-O2b([string]$Question, [bool]$Default = $false) {
  if ($Yes) { return $true }
  $hint = if ($Default) { '[S/n]' } else { '[s/N]' }
  $answer = Read-Host "  $Question $hint"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim() -match '^(s|si|sì|y|yes)$'
}

function Clear-O2bScreen {
  try { Clear-Host } catch { Write-Host '' }
}

# ─── Utilità ───────────────────────────────────────────────────────────────────

function Test-O2bContains([string]$Text, [string]$Part) {
  return [bool]($Text -and $Text.IndexOf($Part, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Test-O2bRepoReference([string]$Text) {
  return (Test-O2bContains $Text $Root) -or (Test-O2bContains $Text $RootSlash)
}

function Test-O2bHttp([string]$Url) {
  try {
    $request = [System.Net.WebRequest]::Create($Url)
    $request.Timeout = 2000
    $request.Proxy = $null
    $response = $request.GetResponse()
    $code = [int]$response.StatusCode
    $response.Close()
    return ($code -ge 200 -and $code -lt 400)
  } catch {
    return $false
  }
}

function Get-O2bDataDir([string]$Name) {
  if ($Name -eq 'example') { return $ExampleDataDir }
  if ($env:O2B_DATA_DIR) { return [System.IO.Path]::GetFullPath($env:O2B_DATA_DIR) }
  return Join-Path $env:USERPROFILE 'Documents\Open2Bill'
}

function Get-O2bNodeVersion {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { return $null }
  $ErrorActionPreference = 'Continue'
  try { return [string](& $node.Source --version | Select-Object -First 1) } catch { return '?' }
}

# Esegue npm in primo piano: l'output resta sulla console, restituisce il codice di uscita.
function Invoke-O2bNpm([string[]]$Arguments) {
  $ErrorActionPreference = 'Continue'
  Push-Location -LiteralPath $Root
  try {
    & npm.cmd @Arguments | Out-Host
    return [int]$LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Test-O2bPrerequisites {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Write-O2bError 'Node.js non trovato: installa Node 22 o superiore e riapri il terminale.'
    return $false
  }
  if (Test-Path -LiteralPath (Join-Path $Root 'node_modules')) { return $true }
  Write-O2bWarn 'Le dipendenze non sono installate (manca node_modules).'
  if (-not (Confirm-O2b 'Eseguo npm install adesso?' $true)) { return $false }
  $code = Invoke-O2bNpm @('install')
  if ($code -ne 0) {
    Write-O2bError "npm install non è riuscito (codice $code)."
    return $false
  }
  return $true
}

# ─── Processi e porte ──────────────────────────────────────────────────────────

function Get-O2bProcessTable {
  return @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath, CreationDate FROM Win32_Process')
}

function ConvertTo-O2bIndex($Table) {
  $index = @{}
  foreach ($p in $Table) { $index[[int]$p.ProcessId] = $p }
  return $index
}

# PID delle radici e di tutti i loro discendenti, dall'alto verso il basso (si termina prima
# chi potrebbe riavviare i figli). Un figlio conta solo se è nato dopo il padre: così un PID
# riciclato da Windows non trascina dentro processi estranei.
function Get-O2bTreeIds($Table, [int[]]$RootIds) {
  $index = ConvertTo-O2bIndex $Table
  $children = @{}
  foreach ($p in $Table) {
    $parent = [int]$p.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = New-Object System.Collections.ArrayList }
    [void]$children[$parent].Add($p)
  }
  $result = New-Object System.Collections.Generic.List[int]
  $seen = @{}
  $queue = New-Object System.Collections.Queue
  foreach ($id in $RootIds) {
    if ($index.ContainsKey($id) -and -not $seen.ContainsKey($id)) {
      $seen[$id] = $true
      $queue.Enqueue($id)
    }
  }
  while ($queue.Count -gt 0) {
    $id = [int]$queue.Dequeue()
    $result.Add($id)
    if (-not $children.ContainsKey($id)) { continue }
    $born = $index[$id].CreationDate
    foreach ($child in $children[$id]) {
      $childId = [int]$child.ProcessId
      if ($childId -eq $id -or $seen.ContainsKey($childId)) { continue }
      if ($born -and $child.CreationDate -and $child.CreationDate -lt $born) { continue }
      $seen[$childId] = $true
      $queue.Enqueue($childId)
    }
  }
  return , $result.ToArray()
}

# Questo script e i suoi antenati (il terminale): non vanno mai terminati.
function Get-O2bProtectedIds($Table) {
  $index = ConvertTo-O2bIndex $Table
  $ids = @{ $PID = $true }
  $id = [int]$PID
  while ($index.ContainsKey($id)) {
    $parent = [int]$index[$id].ParentProcessId
    if ($parent -eq 0 -or $ids.ContainsKey($parent)) { break }
    $ids[$parent] = $true
    $id = $parent
  }
  return $ids
}

# Porte note occupate (veloce, senza PID): serve per l'intestazione del menu.
function Get-O2bBusyPorts {
  $busy = @{}
  try {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($endpoint in $listeners) { $busy[[int]$endpoint.Port] = $true }
  } catch { }
  return $busy
}

# Porta → PID di chi è in ascolto (più lento: solo per stato dettagliato e arresti).
function Get-O2bListeners {
  $map = @{}
  try {
    $ports = [uint16[]]@($KnownPorts | ForEach-Object { $_.Port })
    foreach ($c in @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)) {
      $map[[int]$c.LocalPort] = [int]$c.OwningProcess
    }
  } catch { }
  return $map
}

function Wait-O2bExit([int[]]$Ids, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ($true) {
    $alive = @($Ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($alive.Count -eq 0 -or (Get-Date) -ge $deadline) { return , $alive }
    Start-Sleep -Milliseconds 300
  }
}

# ─── Servizi avviati da questo script ──────────────────────────────────────────

function Get-O2bStateFile([string]$Name) { return Join-Path $RunDir "$Name.json" }
function Get-O2bLogFile([string]$Name) { return Join-Path $RunDir "$Name.log" }

# Il processo radice (cmd.exe) del servizio, se è ancora vivo. Il PID salvato vale solo se
# anche l'ora di avvio coincide: Windows ricicla i PID.
function Get-O2bTracked([string]$Name) {
  $file = Get-O2bStateFile $Name
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try {
    $state = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    $process = Get-Process -Id ([int]$state.ProcessId) -ErrorAction Stop
    $delta = [Math]::Abs($process.StartTime.ToUniversalTime().Ticks - [long]$state.StartTicks)
    if ($delta -gt [TimeSpan]::TicksPerSecond * 2) { throw 'PID riutilizzato' }
    return [pscustomobject]@{ Name = $Name; ProcessId = $process.Id; Started = $process.StartTime }
  } catch {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Get-O2bActiveServices {
  $active = New-Object System.Collections.ArrayList
  foreach ($name in $Services.Keys) {
    $tracked = Get-O2bTracked $name
    if ($tracked) { [void]$active.Add($tracked) }
  }
  return , $active.ToArray()
}

# Tutti i processi riconducibili a Open2Bill: servizi avviati da qui, processi lanciati dal
# repository (anche orfani o da altri terminali), app installata, chi occupa le porte note
# e i loro figli (per esempio il browser headless che genera i PDF).
function Find-O2bProcesses($Table, [hashtable]$Listeners) {
  $index = ConvertTo-O2bIndex $Table
  $reasons = @{}
  $tracked = @{}
  $skipped = New-Object System.Collections.ArrayList

  foreach ($service in (Get-O2bActiveServices)) {
    foreach ($id in (Get-O2bTreeIds $Table @($service.ProcessId))) {
      if (-not $reasons.ContainsKey($id)) {
        $reasons[$id] = "servizio '$($service.Name)' avviato da qui (PID $($service.ProcessId))"
        $tracked[$id] = $true
      }
    }
  }

  foreach ($p in $Table) {
    $id = [int]$p.ProcessId
    if ($reasons.ContainsKey($id)) { continue }
    $name = [string]$p.Name
    $exe = [string]$p.ExecutablePath
    $cmd = [string]$p.CommandLine
    if ($name -eq 'Open2Bill.exe') {
      if (Test-O2bContains $exe $ReleaseDir) { $reasons[$id] = 'build di prova (release\win-unpacked)' }
      else { $reasons[$id] = 'app desktop installata' }
    } elseif ($RepoProcessNames -contains $name -and ((Test-O2bRepoReference $cmd) -or (Test-O2bRepoReference $exe))) {
      $reasons[$id] = 'processo del repository'
    } elseif ($name -eq 'cmd.exe' -and (Test-O2bContains $cmd $RunDir)) {
      $reasons[$id] = 'avviato da questo script'
    }
  }

  foreach ($port in @($Listeners.Keys)) {
    $owner = [int]$Listeners[$port]
    if ($reasons.ContainsKey($owner)) { continue }
    $ownerName = if ($index.ContainsKey($owner)) { [string]$index[$owner].Name } else { '?' }
    if (($RepoProcessNames + 'Open2Bill.exe') -contains $ownerName) {
      $reasons[$owner] = "in ascolto sulla porta $port"
    } else {
      [void]$skipped.Add("La porta $port è occupata da $ownerName (PID $owner): non sembra Open2Bill, lo lascio stare.")
    }
  }

  foreach ($id in (Get-O2bTreeIds $Table @($reasons.Keys))) {
    if (-not $reasons.ContainsKey($id)) { $reasons[$id] = 'processo figlio' }
  }

  foreach ($id in @((Get-O2bProtectedIds $Table).Keys)) { $reasons.Remove($id) }

  $processes = New-Object System.Collections.ArrayList
  foreach ($id in @($reasons.Keys | Sort-Object)) {
    if (-not $index.ContainsKey($id)) { continue }
    [void]$processes.Add([pscustomobject]@{
        ProcessId   = $id
        Name        = [string]$index[$id].Name
        Reason      = $reasons[$id]
        CommandLine = [string]$index[$id].CommandLine
        Tracked     = $tracked.ContainsKey($id)
      })
  }
  return [pscustomobject]@{ Processes = $processes.ToArray(); Skipped = $skipped.ToArray() }
}

function Show-O2bProcessList($Processes) {
  # I servizi avviati da qui sono alberi di decine di processi (cmd, npm, node): una riga sola
  foreach ($group in @($Processes | Where-Object { $_.Tracked } | Group-Object Reason)) {
    Write-Host ('    {0}: {1} processi' -f $group.Name, $group.Count) -ForegroundColor Gray
  }
  foreach ($p in @($Processes | Where-Object { -not $_.Tracked })) {
    Write-Host ('    PID {0,-7} {1,-14} {2}' -f $p.ProcessId, $p.Name, $p.Reason) -ForegroundColor Gray
    $cmd = Format-O2bCommandLine $p.CommandLine
    if ($cmd) { Write-Host "                        $cmd" -ForegroundColor DarkGray }
  }
}

# ─── Avvio ─────────────────────────────────────────────────────────────────────

function Test-O2bServiceReady([string]$Name, [datetime]$Since) {
  $service = $Services[$Name]
  if ($service.Window) {
    # Pronta quando una finestra di Electron lanciata dal repository è visibile
    foreach ($p in @(Get-Process -Name electron -ErrorAction SilentlyContinue)) {
      try {
        if ($p.StartTime -ge $Since.AddSeconds(-2) -and $p.MainWindowHandle -ne [IntPtr]::Zero -and (Test-O2bRepoReference $p.Path)) {
          return $true
        }
      } catch { }
    }
    return $false
  }
  foreach ($url in $service.Checks) {
    if (-not (Test-O2bHttp $url)) { return $false }
  }
  return $true
}

function Show-O2bLogTail([string]$Name, [int]$Lines = 25) {
  $file = Get-O2bLogFile $Name
  if (-not (Test-Path -LiteralPath $file)) { return }
  Write-Host ''
  Write-Host "  Ultime righe del log ($file):" -ForegroundColor DarkGray
  foreach ($line in @(Get-Content -LiteralPath $file -Tail $Lines -Encoding UTF8)) {
    Write-Host "    $line" -ForegroundColor DarkGray
  }
}

function Start-O2bService([string]$Name) {
  $service = $Services[$Name]
  Write-O2bTitle "Avvio: $($service.Label)"

  $running = Get-O2bTracked $Name
  if ($running) {
    Write-O2bWarn "È già in esecuzione (PID $($running.ProcessId), da $(Format-O2bDuration ((Get-Date) - $running.Started)))."
    if ($service.Url) { Write-O2bInfo "Interfaccia: $($service.Url)" }
    return $true
  }
  if (-not (Test-O2bPrerequisites)) { return $false }

  foreach ($other in (Get-O2bActiveServices)) {
    $shared = @($Services[$other.Name].Ports | Where-Object { $service.Ports -contains $_ })
    if ($shared.Count -gt 0) {
      Write-O2bError "Sulle stesse porte ($($shared -join ', ')) gira già '$($Services[$other.Name].Label)', avviato da qui."
      Write-O2bInfo "Fermalo prima con 'Ferma i servizi avviati da qui' (oppure: .\open2bill.ps1 stop)."
      return $false
    }
  }

  if ($service.Ports.Count -gt 0) {
    $listeners = Get-O2bListeners
    $index = $null
    $busy = $false
    foreach ($port in $service.Ports) {
      if (-not $listeners.ContainsKey($port)) { continue }
      if (-not $index) { $index = ConvertTo-O2bIndex (Get-O2bProcessTable) }
      $owner = $listeners[$port]
      $ownerName = if ($index.ContainsKey($owner)) { $index[$owner].Name } else { '?' }
      Write-O2bError "La porta $port è già occupata da $ownerName (PID $owner)."
      $busy = $true
    }
    if ($busy) {
      Write-O2bInfo "Fermala prima con 'Ferma tutto (forzato)' (oppure: .\open2bill.ps1 stop -Force)."
      return $false
    }
  }

  if ($Name -eq 'desktop') {
    if ($env:O2B_DATA_DIR) { Write-O2bRow 'Cartella dati' (Get-O2bDataDir $Name) }
    else { Write-O2bRow 'Cartella dati' "quella scelta nell'app (predefinita: $(Get-O2bDataDir $Name))" }
  } elseif ($Name -eq 'example') {
    Write-O2bRow 'Cartella dati' "$(Get-O2bDataDir $Name) (dati fittizi)"
  } else {
    Write-O2bRow 'Cartella dati' "$(Get-O2bDataDir $Name) (dati reali)" Yellow
  }

  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
  $log = Get-O2bLogFile $Name
  # cmd /s toglie le virgolette esterne: resta  (npm run ...) > "log" 2>&1
  $arguments = '/d /s /c "(' + $service.Npm + ') > "' + $log + '" 2>&1"'
  $since = Get-Date
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  $null = $process.Handle  # tiene l'handle: senza, ExitCode resta vuoto in PowerShell 5.1

  [pscustomobject]@{
    ProcessId  = $process.Id
    StartTicks = [string]$process.StartTime.ToUniversalTime().Ticks
    Command    = $service.Npm
    Started    = $since.ToString('s')
  } | ConvertTo-Json | Set-Content -LiteralPath (Get-O2bStateFile $Name) -Encoding UTF8

  Write-Host '  Avvio in corso' -NoNewline -ForegroundColor Gray
  $deadline = $since.AddSeconds($service.Timeout)
  while ($true) {
    Start-Sleep -Seconds 1
    if ($process.HasExited) {
      Write-Host ''
      Write-O2bError "Il processo si è chiuso subito (codice $($process.ExitCode))."
      Remove-Item -LiteralPath (Get-O2bStateFile $Name) -Force -ErrorAction SilentlyContinue
      Show-O2bLogTail $Name
      return $false
    }
    if (Test-O2bServiceReady $Name $since) { break }
    if ((Get-Date) -ge $deadline) {
      Write-Host ''
      Write-O2bWarn "Ancora nessuna risposta dopo $($service.Timeout) secondi: il processo resta attivo, controlla il log."
      Show-O2bLogTail $Name
      return $false
    }
    Write-Host '.' -NoNewline -ForegroundColor DarkGray
  }
  Write-Host " pronto in $(Format-O2bDuration ((Get-Date) - $since))." -ForegroundColor Green

  if ($service.Url) { Write-O2bRow 'Interfaccia' $service.Url Green }
  if ($service.Window) { Write-O2bInfo "Finestra aperta. Per chiuderla usa la finestra stessa o 'Ferma i servizi'." }
  Write-O2bRow 'Log' $log
  return $true
}

# ─── Arresto ───────────────────────────────────────────────────────────────────

function Stop-O2bTracked($Tracked) {
  $service = $Services[$Tracked.Name]
  Write-Host "  $($service.Label) (PID $($Tracked.ProcessId))... " -NoNewline
  $ids = Get-O2bTreeIds (Get-O2bProcessTable) @($Tracked.ProcessId)

  # Prima la chiusura pulita delle finestre: Electron chiude da solo il suo server interno.
  $windows = 0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero -and $p.CloseMainWindow()) { $windows++ }
  }
  if ($windows -gt 0) { $null = Wait-O2bExit $ids 10 }

  # Poi il resto: i server Node non hanno finestre. Le scritture dei file dati sono
  # atomiche, quindi terminarli non lascia YAML a metà.
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  $alive = Wait-O2bExit $ids 5
  Remove-Item -LiteralPath (Get-O2bStateFile $Tracked.Name) -Force -ErrorAction SilentlyContinue

  if ($alive.Count -gt 0) {
    Write-Host 'non del tutto.' -ForegroundColor Yellow
    Write-O2bWarn "Ancora attivi: PID $($alive -join ', '). Prova 'Ferma tutto (forzato)'."
    return $false
  }
  Write-Host 'fermato.' -ForegroundColor Green
  return $true
}

function Stop-O2bServices {
  Write-O2bTitle 'Arresto dei servizi avviati da qui'
  $active = Get-O2bActiveServices
  if ($active.Count -eq 0) {
    Write-O2bInfo 'Nessun servizio avviato da questo script è in esecuzione.'
    $others = (Find-O2bProcesses (Get-O2bProcessTable) (Get-O2bListeners)).Processes
    if ($others.Count -gt 0) {
      Write-O2bWarn "Processi di Open2Bill avviati altrove: $($others.Count). Per terminarli usa 'Ferma tutto (forzato)'."
    }
    return $true
  }
  $ok = $true
  foreach ($tracked in $active) {
    if (-not (Stop-O2bTracked $tracked)) { $ok = $false }
  }
  return $ok
}

function Stop-O2bForce {
  Write-O2bTitle 'Arresto forzato di tutti i processi di Open2Bill'
  Write-O2bInfo 'Cerco i processi...'
  $found = Find-O2bProcesses (Get-O2bProcessTable) (Get-O2bListeners)
  foreach ($message in $found.Skipped) { Write-O2bWarn $message }
  if ($found.Processes.Count -eq 0) {
    Write-O2bOk 'Nessun processo di Open2Bill in esecuzione.'
    Get-ChildItem -LiteralPath $RunDir -Filter '*.json' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    return $true
  }

  Write-Host ''
  Show-O2bProcessList $found.Processes
  Write-Host ''
  if (@($found.Processes | Where-Object { $_.Reason -eq 'app desktop installata' }).Count -gt 0) {
    Write-O2bWarn "C'è anche l'app desktop installata: le modifiche non salvate andranno perse."
  }
  $question = if ($found.Processes.Count -eq 1) { 'Termino questo processo?' } else { "Termino questi $($found.Processes.Count) processi?" }
  if (-not (Confirm-O2b $question $true)) {
    Write-O2bInfo 'Annullato.'
    return $false
  }

  $ids = [int[]]@($found.Processes | ForEach-Object { $_.ProcessId })
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  $alive = Wait-O2bExit $ids 5
  Get-ChildItem -LiteralPath $RunDir -Filter '*.json' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

  if ($alive.Count -gt 0) {
    Write-O2bError "Non riesco a terminare: PID $($alive -join ', '). Riprova da un terminale aperto come amministratore."
    return $false
  }
  if ($ids.Count -eq 1) { Write-O2bOk 'Fatto: 1 processo terminato.' } else { Write-O2bOk "Fatto: $($ids.Count) processi terminati." }
  return $true
}

# ─── Stato ─────────────────────────────────────────────────────────────────────

function Get-O2bInstaller {
  if (-not (Test-Path -LiteralPath $ReleaseDir)) { return $null }
  return Get-ChildItem -LiteralPath $ReleaseDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Show-O2bStatus {
  Write-O2bTitle 'Stato di Open2Bill'
  Write-O2bInfo 'Raccolgo processi e porte...'
  $table = Get-O2bProcessTable
  $listeners = Get-O2bListeners
  $index = ConvertTo-O2bIndex $table
  Write-Host ''

  $node = Get-O2bNodeVersion
  $deps = if (Test-Path -LiteralPath (Join-Path $Root 'node_modules')) { 'dipendenze installate' } else { 'dipendenze NON installate (npm install)' }
  Write-O2bRow 'Repository' $Root
  if ($node) { Write-O2bRow 'Node.js' "$node, $deps" } else { Write-O2bRow 'Node.js' 'non trovato' Red }
  $dataSource = if ($env:O2B_DATA_DIR) { 'da O2B_DATA_DIR' } else { 'predefinita' }
  Write-O2bRow 'Dati reali' "$(Get-O2bDataDir 'dev') ($dataSource)"
  Write-O2bRow 'Log e PID' $RunDir

  Write-Host ''
  Write-Host '  Servizi avviati da qui' -ForegroundColor Cyan
  foreach ($name in $Services.Keys) {
    $service = $Services[$name]
    $tracked = Get-O2bTracked $name
    Write-Host ('    {0,-9}' -f $name) -NoNewline
    if ($tracked) {
      $detail = "attivo da $(Format-O2bDuration ((Get-Date) - $tracked.Started)), PID $($tracked.ProcessId)"
      if ($service.Url) { $detail += ", $($service.Url)" }
      Write-Host $detail -ForegroundColor Green
    } else {
      Write-Host 'fermo' -ForegroundColor DarkGray
    }
  }

  Write-Host ''
  Write-Host '  Porte' -ForegroundColor Cyan
  foreach ($known in $KnownPorts) {
    Write-Host ('    {0,-6}{1,-24}' -f $known.Port, $known.Label) -NoNewline
    if (-not $listeners.ContainsKey($known.Port)) {
      Write-Host 'libera' -ForegroundColor DarkGray
      continue
    }
    $owner = $listeners[$known.Port]
    $ownerName = if ($index.ContainsKey($owner)) { $index[$owner].Name } else { '?' }
    $text = "in ascolto: $ownerName PID $owner"
    if ($known.Port -eq 3210) {
      if (Test-O2bHttp 'http://127.0.0.1:3210/api/health') { $text += ', API risponde' } else { $text += ', API non risponde' }
    }
    Write-Host $text -ForegroundColor Green
  }

  Write-Host ''
  Write-Host '  Altri processi di Open2Bill (non avviati da qui)' -ForegroundColor Cyan
  $others = @((Find-O2bProcesses $table $listeners).Processes | Where-Object { -not $_.Tracked })
  if ($others.Count -eq 0) {
    Write-Host '    nessuno' -ForegroundColor DarkGray
  } else {
    Show-O2bProcessList $others
    Write-Host "    Si fermano con 'Ferma tutto (forzato)'." -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host '  Ultima build dell''exe' -ForegroundColor Cyan
  $installer = Get-O2bInstaller
  if ($installer) {
    Write-Host ('    {0}  {1:N1} MB  {2}' -f $installer.Name, ($installer.Length / 1MB), $installer.LastWriteTime.ToString('dd/MM/yyyy HH:mm'))
    Write-Host "    $($installer.FullName)" -ForegroundColor DarkGray
  } else {
    Write-Host '    nessuna: usa Compila exe' -ForegroundColor DarkGray
  }
  return $true
}

# ─── Log, browser, build ───────────────────────────────────────────────────────

function Show-O2bLogs([string]$Name) {
  if (-not $Name) {
    $available = @($Services.Keys | Where-Object { Test-Path -LiteralPath (Get-O2bLogFile $_) })
    if ($available.Count -eq 0) {
      Write-O2bInfo 'Nessun log: si crea quando avvii un servizio da questo script.'
      return $true
    }
    if ($available.Count -eq 1) {
      $Name = $available[0]
    } else {
      Write-O2bTitle 'Di quale servizio?'
      for ($i = 0; $i -lt $available.Count; $i++) {
        Write-Host ('    {0}  {1}' -f ($i + 1), $Services[$available[$i]].Label)
      }
      $choice = Read-Host '  Scelta'
      $number = 0
      if (-not [int]::TryParse($choice, [ref]$number) -or $number -lt 1 -or $number -gt $available.Count) {
        Write-O2bWarn 'Scelta non valida.'
        return $false
      }
      $Name = $available[$number - 1]
    }
  }

  $file = Get-O2bLogFile $Name
  if (-not (Test-Path -LiteralPath $file)) {
    Write-O2bInfo "Nessun log per '$Name': si crea quando avvii il servizio da questo script."
    return $true
  }
  Write-O2bTitle "Log: $($Services[$Name].Label)"
  foreach ($line in @(Get-Content -LiteralPath $file -Tail 40 -Encoding UTF8)) { Write-Host "    $line" }
  Write-Host ''
  Write-O2bRow 'File completo' $file
  if ($Interactive -and (Confirm-O2b 'Lo apro nel Blocco note?')) { Start-Process notepad.exe -ArgumentList "`"$file`"" }
  return $true
}

function Open-O2bBrowser {
  $url = $null
  foreach ($tracked in (Get-O2bActiveServices)) {
    if ($Services[$tracked.Name].Url) { $url = $Services[$tracked.Name].Url; break }
  }
  if (-not $url) {
    if (Test-O2bHttp 'http://localhost:5273/') { $url = 'http://localhost:5273/' }
    elseif (Test-O2bHttp 'http://127.0.0.1:3210/api/health') { $url = 'http://localhost:3210/' }
  }
  if (-not $url) {
    Write-O2bWarn "Nessuna interfaccia web attiva: avviane una dal menu (1, 2 o 4)."
    return $false
  }
  Write-O2bInfo "Apro $url"
  Start-Process $url
  return $true
}

function Invoke-O2bBuild {
  Write-O2bTitle "Compilazione dell'installer Windows (npm run dist:win)"
  if (-not (Test-O2bPrerequisites)) { return $false }

  # Con la build di prova aperta, electron-builder non riesce a sovrascrivere win-unpacked.
  $table = Get-O2bProcessTable
  $locking = @($table | Where-Object { $_.ExecutablePath -and (Test-O2bContains ([string]$_.ExecutablePath) $ReleaseDir) })
  if ($locking.Count -gt 0) {
    Write-O2bWarn 'La build di prova in release\win-unpacked è aperta e bloccherebbe la compilazione.'
    if (-not (Confirm-O2b 'La chiudo e proseguo?' $true)) { return $false }
    $ids = Get-O2bTreeIds $table @($locking | ForEach-Object { [int]$_.ProcessId })
    foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    $null = Wait-O2bExit $ids 5
  }

  Write-O2bInfo 'Compilo UI e app desktop, poi creo l''installer: può richiedere qualche minuto.'
  Write-Host ''
  $since = Get-Date
  $code = Invoke-O2bNpm @('run', 'dist:win')
  $elapsed = Format-O2bDuration ((Get-Date) - $since)
  Write-Host ''
  if ($code -ne 0) {
    Write-O2bError "Compilazione non riuscita (codice $code) dopo ${elapsed}: l'errore è nell'output qui sopra."
    return $false
  }

  $installer = Get-O2bInstaller
  if (-not $installer -or $installer.LastWriteTime -lt $since) {
    Write-O2bWarn "npm ha terminato senza errori, ma non trovo un installer nuovo in $ReleaseDir."
    return $false
  }
  Write-O2bOk ('Installer pronto in {0}: {1} ({2:N1} MB)' -f $elapsed, $installer.Name, ($installer.Length / 1MB))
  Write-O2bRow 'Percorso' $installer.FullName
  Write-O2bInfo 'Non è firmato: al primo avvio Windows SmartScreen può chiedere conferma'
  Write-O2bInfo '("Ulteriori informazioni", poi "Esegui comunque").'
  if ($Interactive -and (Confirm-O2b 'Apro la cartella?')) {
    Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
  }
  return $true
}

# ─── Menu ──────────────────────────────────────────────────────────────────────

function Write-O2bHeader {
  Write-Host ''
  Write-Host '  Open2Bill' -ForegroundColor Cyan -NoNewline
  Write-Host '  pannello di controllo' -ForegroundColor Gray
  Write-Host "  $Root" -ForegroundColor DarkGray
  Write-Host ''

  $active = Get-O2bActiveServices
  Write-Host '  Servizi  ' -NoNewline -ForegroundColor DarkGray
  if ($active.Count -eq 0) {
    Write-Host 'nessuno avviato da qui' -ForegroundColor DarkGray
  } else {
    $parts = foreach ($t in $active) { "$($t.Name) attivo da $(Format-O2bDuration ((Get-Date) - $t.Started))" }
    Write-Host ($parts -join ', ') -ForegroundColor Green
  }

  # Una porta occupata senza servizi avviati da qui di solito è un processo orfano.
  $busy = Get-O2bBusyPorts
  $expected = @{}
  foreach ($t in $active) { foreach ($port in $Services[$t.Name].Ports) { $expected[[int]$port] = $true } }
  Write-Host '  Porte    ' -NoNewline -ForegroundColor DarkGray
  $orphans = $false
  foreach ($known in $KnownPorts) {
    if (-not $busy.ContainsKey($known.Port)) {
      Write-Host "$($known.Port) libera   " -NoNewline -ForegroundColor DarkGray
    } elseif ($expected.ContainsKey($known.Port)) {
      Write-Host "$($known.Port) in uso   " -NoNewline -ForegroundColor Green
    } else {
      Write-Host "$($known.Port) occupata   " -NoNewline -ForegroundColor Yellow
      $orphans = $true
    }
  }
  Write-Host ''
  if ($orphans) {
    Write-Host '           una porta è occupata da un processo non avviato da qui (vedi 7, si libera con 6)' -ForegroundColor Yellow
  }
  Write-Host ''
}

function Write-O2bMenuItem([string]$Key, [string]$Label, [string]$Hint = '') {
  Write-Host ('    {0}  ' -f $Key) -NoNewline -ForegroundColor Cyan
  Write-Host ('{0,-36}' -f $Label) -NoNewline
  Write-Host $Hint -ForegroundColor DarkGray
}

function Exit-O2bMenu {
  $active = Get-O2bActiveServices
  if ($active.Count -eq 0) { return $true }
  $names = ($active | ForEach-Object { $_.Name }) -join ', '
  Write-O2bWarn "Restano attivi in background: $names."
  if (Confirm-O2b 'Li fermo prima di uscire?') {
    foreach ($tracked in $active) { $null = Stop-O2bTracked $tracked }
  } else {
    Write-O2bInfo 'Restano attivi: per fermarli riapri questo script.'
  }
  return $true
}

function Show-O2bMenu {
  while ($true) {
    Clear-O2bScreen
    Write-O2bHeader
    Write-Host '  Avvia' -ForegroundColor Gray
    Write-O2bMenuItem '1' $Services['dev'].Label $Services['dev'].Hint
    Write-O2bMenuItem '2' $Services['example'].Label $Services['example'].Hint
    Write-O2bMenuItem '3' $Services['desktop'].Label $Services['desktop'].Hint
    Write-O2bMenuItem '4' $Services['server'].Label $Services['server'].Hint
    Write-Host '  Ferma' -ForegroundColor Gray
    Write-O2bMenuItem '5' 'Ferma i servizi avviati da qui' 'chiude prima le finestre, poi termina'
    Write-O2bMenuItem '6' 'Ferma tutto (forzato)' 'anche processi orfani e app installata'
    Write-Host '  Strumenti' -ForegroundColor Gray
    Write-O2bMenuItem '7' 'Stato dettagliato' 'servizi, porte, processi, ultima build'
    Write-O2bMenuItem '8' 'Compila exe' 'installer Windows in apps\desktop\release'
    Write-O2bMenuItem '9' 'Apri nel browser'
    Write-O2bMenuItem 'L' 'Mostra log'
    Write-O2bMenuItem '0' 'Esci'
    Write-Host ''

    $choice = ([string](Read-Host '  Scelta')).Trim().ToLower()
    $pause = $true
    switch ($choice) {
      '1' { $null = Start-O2bService 'dev' }
      '2' { $null = Start-O2bService 'example' }
      '3' { $null = Start-O2bService 'desktop' }
      '4' { $null = Start-O2bService 'server' }
      '5' { $null = Stop-O2bServices }
      '6' { $null = Stop-O2bForce }
      '7' { $null = Show-O2bStatus }
      '8' { $null = Invoke-O2bBuild }
      '9' { $null = Open-O2bBrowser }
      'l' { $null = Show-O2bLogs '' }
      { $_ -in '0', 'q', 'esci' } { $null = Exit-O2bMenu; return }
      '' { $pause = $false }
      default { Write-O2bWarn "Scelta non valida: $choice" }
    }
    if ($pause) {
      Write-Host ''
      $null = Read-Host '  Premi Invio per tornare al menu'
    }
  }
}

# ─── Avvio dello script ────────────────────────────────────────────────────────

# L'output di npm è UTF-8: senza questo le lettere accentate escono storpiate.
$originalEncoding = $null
try {
  $originalEncoding = [Console]::OutputEncoding
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch { }

$success = $true
try {
  switch ($Command) {
    'menu' { Show-O2bMenu }
    'start' { if (-not $Target) { $Target = 'dev' }; $success = Start-O2bService $Target }
    'stop' { if ($Force) { $success = Stop-O2bForce } else { $success = Stop-O2bServices } }
    'status' { $success = Show-O2bStatus }
    'logs' { $success = Show-O2bLogs $Target }
    'build' { $success = Invoke-O2bBuild }
  }
} finally {
  if ($originalEncoding) {
    try { [Console]::OutputEncoding = $originalEncoding } catch { }
  }
}
if (-not $success) { exit 1 }
