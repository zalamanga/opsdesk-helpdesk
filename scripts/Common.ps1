$ErrorActionPreference = 'Stop'
$OpsDeskRoot = Split-Path -Parent $PSScriptRoot

function New-OpsDeskSecret {
    $bytes = New-Object byte[] 24
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Invoke-OpsDeskCompose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArguments)
    Invoke-OpsDeskDocker -DockerArguments (@('compose', '--project-name', 'opsdesk', '--project-directory', $OpsDeskRoot, '--file', (Join-Path $OpsDeskRoot 'compose.yml'), '--env-file', (Join-Path $OpsDeskRoot '.env')) + $ComposeArguments)
}

function Invoke-OpsDeskDocker {
    param([Parameter(Mandatory = $true)][string[]]$DockerArguments)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5 treats native stderr progress as ErrorRecord when redirected.
        $ErrorActionPreference = 'Continue'
        & docker @DockerArguments 2>&1 | ForEach-Object { $_.ToString() }
        $dockerExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($dockerExit -ne 0) { throw "Docker failed (exit $dockerExit)." }
}
