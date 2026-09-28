[CmdletBinding(PositionalBinding = $false)]
param(
    [switch]$Fetch,
    [string]$ParentDir = ""
)

<#
.SYNOPSIS
Reports uncommitted or unpushed work in zmanager-desktop and its sibling repositories.

.DESCRIPTION
Checks zmanager-desktop, tzap, zmanager, localsend-rs, forensic-vfs-engine
and iso9660-forensic for:
  - uncommitted changes (staged, unstaged or untracked files)
  - stash entries
  - local branches with commits not pushed to their upstream
  - local branches with no upstream
  - a detached HEAD with commits not on any remote branch

Nothing is modified. With -Fetch, each repository fetches origin first so the
report also shows branches that are behind their upstream.

Sibling locations honour the same ZMANAGER_*_DIR overrides as
ensure-sibling-repos.ps1.

Exits 0 when every repository is clean and pushed, 1 otherwise.
#>

$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($ParentDir) {
    $parentDir = [System.IO.Path]::GetFullPath($ParentDir)
} else {
    $parentDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".."))
}

function Resolve-RepoDir {
    param([string]$EnvName, [string]$Name)
    $override = [Environment]::GetEnvironmentVariable($EnvName)
    if ($override) { return $override }
    return Join-Path $parentDir $Name
}

$repos = @(
    [pscustomobject]@{ Name = "zmanager-desktop";    Dir = $repoRoot },
    [pscustomobject]@{ Name = "tzap";                Dir = Resolve-RepoDir "ZMANAGER_TZAP_DIR" "tzap" },
    [pscustomobject]@{ Name = "zmanager";            Dir = Resolve-RepoDir "ZMANAGER_ZMANAGER_DIR" "zmanager" },
    [pscustomobject]@{ Name = "localsend-rs";        Dir = Resolve-RepoDir "ZMANAGER_LOCALSEND_DIR" "localsend-rs" },
    [pscustomobject]@{ Name = "forensic-vfs-engine"; Dir = Resolve-RepoDir "ZMANAGER_FORENSIC_VFS_ENGINE_DIR" "forensic-vfs-engine" },
    [pscustomobject]@{ Name = "iso9660-forensic";    Dir = Resolve-RepoDir "ZMANAGER_ISO9660_FORENSIC_DIR" "iso9660-forensic" }
)

function Resolve-GitCommand {
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) { return $git.Source }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) { return $git.Source }

    $candidates = @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "C:\Program Files (x86)\Git\cmd\git.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    throw "Git was not found. Install Git for Windows, or put git.exe on PATH."
}

$git = Resolve-GitCommand

function Invoke-Git {
    param([string]$Directory, [string[]]$Arguments)
    $output = & $git -C $Directory @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed in $Directory (exit $LASTEXITCODE)"
    }
    return @($output | Where-Object { $_ -ne $null -and $_ -ne "" })
}

function Get-RepoIssues {
    param([string]$Directory)

    $issues = New-Object System.Collections.Generic.List[string]

    if (-not (Test-Path $Directory)) {
        $issues.Add("missing: $Directory")
        return $issues
    }
    & $git -C $Directory rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) {
        $issues.Add("not a Git worktree: $Directory")
        return $issues
    }

    if ($Fetch) {
        & $git -C $Directory fetch --prune --no-tags --quiet origin *> $null
        if ($LASTEXITCODE -ne 0) {
            $issues.Add("fetch from origin failed; remote state may be stale")
        }
    }

    $status = Invoke-Git $Directory @("status", "--porcelain=v1", "--untracked-files=normal")
    if ($status.Count -gt 0) {
        $issues.Add("$($status.Count) uncommitted change(s):")
        foreach ($line in ($status | Select-Object -First 15)) { $issues.Add("    $line") }
        if ($status.Count -gt 15) { $issues.Add("    ... and $($status.Count - 15) more") }
    }

    $stashes = Invoke-Git $Directory @("stash", "list")
    if ($stashes.Count -gt 0) {
        $issues.Add("$($stashes.Count) stash entr$(if ($stashes.Count -eq 1) { 'y' } else { 'ies' })")
    }

    $branches = Invoke-Git $Directory @("for-each-ref", "--format=%(refname:short)|%(upstream:short)|%(upstream:track)", "refs/heads")
    foreach ($entry in $branches) {
        $branch, $upstream, $track = $entry -split "\|", 3
        if (-not $upstream) {
            $unpushed = Invoke-Git $Directory @("rev-list", "--count", $branch, "--not", "--remotes")
            if ([int]$unpushed[0] -gt 0) {
                $issues.Add("branch '$branch' has no upstream ($($unpushed[0]) commit(s) not on any remote)")
            }
            continue
        }
        if ($track -eq "[gone]") {
            $issues.Add("branch '$branch' tracks '$upstream', which no longer exists on the remote")
            continue
        }
        $counts = (Invoke-Git $Directory @("rev-list", "--left-right", "--count", "$branch...$upstream"))[0] -split "\s+"
        $ahead = [int]$counts[0]
        $behind = [int]$counts[1]
        if ($ahead -gt 0) {
            $issues.Add("branch '$branch' is $ahead commit(s) ahead of '$upstream' (not pushed)")
        }
        if ($behind -gt 0) {
            $issues.Add("branch '$branch' is $behind commit(s) behind '$upstream'")
        }
    }

    & $git -C $Directory symbolic-ref -q HEAD *> $null
    if ($LASTEXITCODE -ne 0) {
        $unpushed = Invoke-Git $Directory @("rev-list", "--count", "HEAD", "--not", "--remotes")
        if ([int]$unpushed[0] -gt 0) {
            $issues.Add("detached HEAD has $($unpushed[0]) commit(s) not on any remote")
        }
    }

    return $issues
}

$dirtyCount = 0
foreach ($repo in $repos) {
    try {
        $issues = Get-RepoIssues -Directory $repo.Dir
    } catch {
        $issues = @("check failed: $_")
    }

    $head = ""
    if (Test-Path $repo.Dir) {
        $head = (& $git -C $repo.Dir rev-parse --abbrev-ref HEAD 2>$null)
        if ($head) { $head = " [$head]" }
    }

    if ($issues.Count -eq 0) {
        Write-Host "[ OK ] $($repo.Name)$head" -ForegroundColor Green
    } else {
        $dirtyCount++
        Write-Host "[WARN] $($repo.Name)$head  $($repo.Dir)" -ForegroundColor Yellow
        foreach ($issue in $issues) { Write-Host "       $issue" }
    }
}

Write-Host ""
if ($dirtyCount -eq 0) {
    Write-Host "All $($repos.Count) repositories are clean and pushed." -ForegroundColor Green
    exit 0
}
Write-Host "$dirtyCount of $($repos.Count) repositories need attention." -ForegroundColor Yellow
exit 1
