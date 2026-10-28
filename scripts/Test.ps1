. (Join-Path $PSScriptRoot 'Common.ps1')
$projectRoot = $OpsDeskRoot
$testProject = 'opsdesk-tests-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$testCompose = Join-Path $projectRoot 'compose.test.yml'
try {
    Invoke-OpsDeskDocker -DockerArguments @('compose', '--project-name', $testProject, '--file', $testCompose, 'run', '--build', '--rm', 'tests')
} finally {
    try {
        Invoke-OpsDeskDocker -DockerArguments @('compose', '--project-name', $testProject, '--file', $testCompose, 'down', '--remove-orphans')
    } catch { Write-Warning "Cleanup failed for isolated test project $testProject. $($_.Exception.Message)" }
}
