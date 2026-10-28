. (Join-Path $PSScriptRoot 'Common.ps1')
Invoke-OpsDeskCompose -ComposeArguments @('stop')
Write-Output 'Container OpsDesk dihentikan. Database tetap tersimpan pada volume proyek.'
