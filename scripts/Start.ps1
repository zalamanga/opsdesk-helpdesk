param([switch]$NoBuild)
. (Join-Path $PSScriptRoot 'Common.ps1')
$configPath = Join-Path $OpsDeskRoot '.env'
if (-not (Test-Path -LiteralPath $configPath)) {
    $databasePassword = New-OpsDeskSecret
    $demoPassword = New-OpsDeskSecret
    $config = @(
        'OPSDESK_HTTP_PORT=8091'
        "OPSDESK_DB_PASSWORD=$databasePassword"
        "OPSDESK_DEMO_PASSWORD=$demoPassword"
        'OPSDESK_DEMO_MODE=true'
        'OPSDESK_SEED_DEMO=true'
        'OPSDESK_COOKIE_SECURE=false'
    )
    [IO.File]::WriteAllLines($configPath, $config)
    $privateDirectory = Join-Path $OpsDeskRoot '.local'
    New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
    $credentialText = @(
        'OpsDesk - akun latihan lokal, jangan unggah berkas ini.'
        'URL: http://localhost:8091'
        'Agen: agent@opsdesk.test'
        'Agen kedua: agent2@opsdesk.test'
        'Requester: requester@opsdesk.test'
        'Requester kedua: another@opsdesk.test'
        "Sandi latihan: $demoPassword"
        'Sandi hanya diatur ketika seed pertama membuat akun. Mengubah .env tidak mereset sandi akun yang sudah ada.'
    )
    [IO.File]::WriteAllLines((Join-Path $privateDirectory 'LOCAL-CREDENTIALS.txt'), $credentialText)
}
$arguments = @('up', '-d', '--wait', '--wait-timeout', '180')
if (-not $NoBuild) { $arguments += '--build' }
Invoke-OpsDeskCompose -ComposeArguments $arguments
Write-Output 'OpsDesk siap: http://localhost:8091 (atau port yang diatur pada .env).'
if (Test-Path -LiteralPath (Join-Path $OpsDeskRoot '.local\LOCAL-CREDENTIALS.txt')) {
    Write-Output 'Akun latihan lokal: .local\LOCAL-CREDENTIALS.txt; kata sandi tidak dicetak di terminal.'
} else {
    Write-Output 'Gunakan sandi yang diatur saat seed pertama. Konfigurasi manual tidak membuat berkas kredensial otomatis.'
}
