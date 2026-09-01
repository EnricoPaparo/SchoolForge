[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,

  [string]$WorkingDirectory,

  [ValidateSet('read-only', 'workspace-write')]
  [string]$Sandbox = 'read-only',

  [switch]$AllowWrite,

  [switch]$PersistSession,

  [switch]$IncludeStagedDiff,

  [string]$OutputFile
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$promptPath = (Resolve-Path -LiteralPath $PromptFile).Path
$targetDirectory = if ($WorkingDirectory) {
  (Resolve-Path -LiteralPath $WorkingDirectory).Path
} else {
  $repoRoot
}
$supportHome = Join-Path $HOME '.codex-schoolforge-support'

if (-not (Test-Path -LiteralPath $supportHome -PathType Container)) {
  throw "Profilo Codex di supporto assente: $supportHome"
}

$codexCommand = Get-Command codex -ErrorAction Stop
$promptText = Get-Content -LiteralPath $promptPath -Raw

if ($IncludeStagedDiff) {
  $stagedDiffLines = & git -C $targetDirectory diff --cached --no-ext-diff --
  if ($LASTEXITCODE -ne 0) {
    throw 'Impossibile leggere il diff staged da passare al Codex di supporto.'
  }

  $stagedDiff = $stagedDiffLines -join [Environment]::NewLine
  if ([string]::IsNullOrWhiteSpace($stagedDiff)) {
    throw 'Il diff staged richiesto è vuoto.'
  }

  $promptText += "`n`n<staged_diff>`n$stagedDiff`n</staged_diff>`n"
}

if ($Sandbox -eq 'workspace-write') {
  if (-not $AllowWrite) {
    throw 'workspace-write richiede -AllowWrite esplicito.'
  }

  $primaryGitRoot = (& git -C $repoRoot rev-parse --show-toplevel).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($primaryGitRoot)) {
    throw 'Impossibile risolvere la radice Git della checkout primaria.'
  }

  $targetGitRoot = (& git -C $targetDirectory rev-parse --show-toplevel).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($targetGitRoot)) {
    throw 'La directory di scrittura deve appartenere a una checkout Git.'
  }

  $primaryGitRoot = [System.IO.Path]::GetFullPath($primaryGitRoot).TrimEnd('\')
  $targetGitRoot = [System.IO.Path]::GetFullPath($targetGitRoot).TrimEnd('\')
  if ([string]::Equals($targetGitRoot, $primaryGitRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Il Codex di supporto può scrivere soltanto in un worktree separato.'
  }

  $worktreeLines = & git -C $repoRoot worktree list --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw 'Impossibile leggere i worktree registrati di SchoolForge.'
  }

  $registeredWorktreeRoots = @(
    $worktreeLines |
      Where-Object { $_.StartsWith('worktree ', [System.StringComparison]::Ordinal) } |
      ForEach-Object {
        [System.IO.Path]::GetFullPath($_.Substring('worktree '.Length)).TrimEnd('\')
      }
  )
  $isRegisteredWorktree = $registeredWorktreeRoots | Where-Object {
    [string]::Equals($_, $targetGitRoot, [System.StringComparison]::OrdinalIgnoreCase)
  }
  if (-not $isRegisteredWorktree) {
    throw 'La directory di scrittura non è un worktree registrato di SchoolForge.'
  }

  $branch = (& git -C $targetDirectory branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw 'La directory di scrittura deve essere una checkout Git su un branch.'
  }
  if ($branch -eq 'main') {
    throw 'Il Codex di supporto non può scrivere sulla checkout di main.'
  }
}

$previousCodexHome = $env:CODEX_HOME
try {
  $env:CODEX_HOME = $supportHome

  & $codexCommand.Source login status | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw 'Il profilo Codex di supporto non è autenticato.'
  }

  $arguments = @(
    'exec',
    '-C',
    $targetDirectory,
    '-s',
    $Sandbox,
    '--color',
    'never'
  )

  if (-not $PersistSession) {
    $arguments += '--ephemeral'
  }
  if ($OutputFile) {
    $arguments += @('-o', $OutputFile)
  }
  $arguments += '-'

  $promptText | & $codexCommand.Source @arguments
  exit $LASTEXITCODE
} finally {
  $env:CODEX_HOME = $previousCodexHome
}
