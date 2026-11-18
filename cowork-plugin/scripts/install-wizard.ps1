# Smartsheet for Copilot Cowork: setup wizard.
#
# Walks a non-technical Eide Bailly user through installing the Smartsheet Cowork plugin.
# Needs no admin rights and no prior Node.js: it downloads a portable Node.js and the
# Microsoft 365 Agents Toolkit CLI into %LOCALAPPDATA%\smartsheet-cowork-setup, then runs
#   atk auth login m365
#   atk install --file-path smartsheet-cowork-plugin.zip --scope Personal
#
# Run it by pasting this one line into Windows PowerShell:
#   irm https://raw.githubusercontent.com/ddaou-eb/smartsheet-mcp/main/cowork-plugin/scripts/install-wizard.ps1 | iex
#
# A PowerShell port of the /wizard bash template, so it runs on any Windows laptop.
# Everything runs inside one script block so "return" ends the wizard without closing
# the user's PowerShell window (which "exit" would do under iex).

& {
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$NodeVersion = 'v26.13.1'
$PluginUrl = 'https://github.com/ddaou-eb/smartsheet-mcp/releases/download/v0.1.0/smartsheet-cowork-plugin.zip'
$Dir = Join-Path $env:LOCALAPPDATA 'smartsheet-cowork-setup'
$NodeDir = Join-Path $Dir "node-$NodeVersion-win-x64"
$Atk = Join-Path $NodeDir 'atk.cmd'
$PluginZip = Join-Path $Dir 'smartsheet-cowork-plugin.zip'
$ToolLog = Join-Path $Dir 'tool-install.log'
$InstallLog = Join-Path $Dir 'plugin-install.log'

# ---------------------------------------------------------------------------
# Wizard library: same flow as the /wizard template, in PowerShell.
# ---------------------------------------------------------------------------

$TotalStages = 4
$script:StageIndex = 0

function Clear-Wiz { try { Clear-Host } catch { } }
function Say([string]$t) { Write-Host "  $t" }
function Step([string]$t) { Write-Host '  * ' -ForegroundColor Cyan -NoNewline; Write-Host $t }
function Note([string]$t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Warn([string]$t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Ok([string]$t) { Write-Host "  [OK] $t" -ForegroundColor Green }

function Wait-Enter([string]$msg = 'Press Enter to continue') {
    Write-Host "  $msg " -ForegroundColor DarkGray -NoNewline
    [void](Read-Host)
}

function Confirm-Wiz([string]$q) {
    Write-Host "  ? $q [y/N] " -ForegroundColor Yellow -NoNewline
    $reply = Read-Host
    return ($reply -match '^[Yy]')
}

function Show-Banner([string]$title) {
    Clear-Wiz
    Write-Host ''
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "  $TotalStages steps, about 10 minutes" -ForegroundColor DarkGray
    Write-Host ''
    Say 'This adds Smartsheet to your Copilot Cowork.'
    Say 'It tells you exactly what to do at each step.'
    Say 'Nothing happens until you press Enter.'
    Write-Host ''
    Wait-Enter 'Ready? Press Enter to start'
}

function Start-Stage([string]$name) {
    Clear-Wiz
    $script:StageIndex++
    Write-Host ''
    Write-Host ("  Step {0} of {1}: {2}" -f $script:StageIndex, $TotalStages, $name) -ForegroundColor Cyan
    Write-Host ''
}

function Show-Problem([string]$msg, [string]$log) {
    Write-Host ''
    Warn $msg
    if ($log -and (Test-Path $log)) {
        Write-Host ''
        Note 'Details:'
        Get-Content $log -Tail 8 | ForEach-Object { Note "  $_" }
    }
    Write-Host ''
    Say 'Take a screenshot of this window and send it to Daniel Daou.'
    Wait-Enter 'Press Enter to close the wizard'
}

# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

Show-Banner 'Smartsheet for Copilot Cowork: setup'

# -- Step 1: download portable Node.js, the Agents Toolkit CLI, and the plugin zip --
Start-Stage 'Get everything ready'
Say 'This downloads what the setup needs into your own user folder.'
Say 'No admin rights needed. It takes about 5 minutes.'
Say 'Keep this window open.'
Write-Host ''
Wait-Enter 'Press Enter to start the downloads'
Write-Host ''

New-Item -ItemType Directory -Force $Dir | Out-Null

if (Test-Path (Join-Path $NodeDir 'npm.cmd')) {
    Ok 'Download 1 of 3 is already done.'
} else {
    Say 'Download 1 of 3: helper tool. Please wait...'
    $nodeZip = Join-Path $Dir 'node.zip'
    $extract = Join-Path $Dir 'extract-tmp'
    try {
        Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $nodeZip -UseBasicParsing -ErrorAction Stop
        # Unzip to a temp folder and rename at the end, so a half-finished unzip is never mistaken for a finished one.
        if (Test-Path $extract) { Remove-Item $extract -Recurse -Force -ErrorAction Stop }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $extract)
        if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force -ErrorAction Stop }
        Move-Item (Join-Path $extract "node-$NodeVersion-win-x64") $NodeDir -ErrorAction Stop
        Remove-Item $extract, $nodeZip -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Show-Problem "Download 1 of 3 didn't work. Check that you're online (and on VPN if you're remote), then paste the line again." $null
        return
    }
    Ok 'Download 1 of 3 done.'
}

# npm.cmd and atk.cmd find node.exe next to themselves; PATH just lets npm's own child processes find it too.
$env:Path = "$NodeDir;$env:Path"

if (Test-Path $Atk) {
    Ok 'Download 2 of 3 is already done.'
} else {
    Say 'Download 2 of 3: Microsoft setup tool. This is the slow one (2 to 5 minutes)...'
    & (Join-Path $NodeDir 'npm.cmd') install -g --prefix "$NodeDir" '--allow-scripts=@microsoft/m365agentstoolkit-cli,@azure/msal-node-extensions,keytar' '@microsoft/m365agentstoolkit-cli' *> $ToolLog
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Atk)) {
        Show-Problem "Download 2 of 3 didn't work. Check that you're online, then paste the line again." $ToolLog
        return
    }
    Ok 'Download 2 of 3 done.'
}

Say 'Download 3 of 3: the Smartsheet plugin. Please wait...'
try {
    Invoke-WebRequest $PluginUrl -OutFile $PluginZip -UseBasicParsing -ErrorAction Stop
} catch {
    Show-Problem "Download 3 of 3 didn't work. Check that you're online, then paste the line again." $null
    return
}
Ok 'Download 3 of 3 done.'
Write-Host ''
Wait-Enter 'All downloads are done. Press Enter for the next step'

# -- Step 2: sign in to Microsoft 365 --
Start-Stage 'Sign in to Microsoft'
Say 'When you press Enter, a browser window will open.'
Write-Host ''
Step 'Choose your Eide Bailly account (your @eidebailly.com email).'
Step 'Sign in the way you normally do.'
Step 'When the browser says sign-in is complete, come back to this window.'
Write-Host ''
Wait-Enter 'Press Enter to open the sign-in page'
Write-Host ''

& $Atk auth login m365

$who = (& $Atk auth list 2>&1 | Out-String)
if ($who -match 'Microsoft 365 account is:\s*(\S+@[^\s]+?)\.?(\s|$)') {
    Write-Host ''
    Ok "You're signed in as $($Matches[1])"
} else {
    Show-Problem "The sign-in didn't finish. Paste the line again to retry. The downloads won't repeat." $null
    return
}
Write-Host ''
Wait-Enter 'Press Enter for the next step'

# -- Step 3: install the plugin, personal scope (no IT approval queue) --
Start-Stage 'Add Smartsheet to your Copilot'
Say 'This adds the Smartsheet plugin to your Copilot.'
Say 'It is just for you. Nobody else is affected.'
Write-Host ''
if (-not (Confirm-Wiz 'Add it now? Type y and press Enter')) {
    Write-Host ''
    Say 'No problem. Nothing was added.'
    Say 'Paste the line again whenever you are ready.'
    Wait-Enter 'Press Enter to close the wizard'
    return
}
Write-Host ''
Say 'Adding it now. This takes about a minute...'

& $Atk install --file-path "$PluginZip" --scope Personal *> $InstallLog
if ($LASTEXITCODE -ne 0) {
    Show-Problem "Smartsheet couldn't be added to your Copilot." $InstallLog
    return
}
Ok 'Smartsheet has been added to your Copilot.'
Write-Host ''
Wait-Enter 'Press Enter for the last step'

# -- Step 4: enable in Cowork and complete Smartsheet OAuth --
Start-Stage 'Turn it on in Cowork'
Say 'Last step. Leave this window open and do this in Cowork:'
Write-Host ''
Step 'Open Cowork.'
Step 'Find "Smartsheet Tools" in your plugins or connectors, and switch it on.'
Step 'In the chat box, type: List my favorite Smartsheet sheets'
Step 'When it asks you to sign in to Smartsheet, sign in and approve access.'
Write-Host ''
Note "Don't see Smartsheet Tools? Close Cowork completely, open it again, and look again."
Write-Host ''
Wait-Enter 'Press Enter when you can see your Smartsheet sheets in Cowork'

# -- Finish --
Clear-Wiz
Write-Host ''
Write-Host '  All set. Smartsheet is ready to use in Cowork.' -ForegroundColor Green
Write-Host ''
Say 'You can close this window.'
Write-Host ''
Note "Setup files are in $Dir"
Note 'They are not needed anymore. You can delete that folder to free up space.'
Write-Host ''
}
