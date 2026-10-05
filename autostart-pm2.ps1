# Jalankan semua aplikasi PM2 (WhatsOrbit, ngrok, aplikasi fingerprint) otomatis saat PC menyala,
# TANPA perlu login Windows. Berguna setelah mati lampu: PC menyala sendiri, aplikasi langsung jalan.
#
# Cara pakai: klik ganda autostart-pm2.cmd lalu pilih "Yes" saat Windows meminta izin Administrator.
#
# Task Scheduler "WhatsOrbit (PM2)" diubah dari "saat login" menjadi "saat PC menyala" (1 menit
# setelah booting, menunggu jaringan siap) dan berjalan walaupun belum ada yang login.
# Password Windows tidak disimpan (mode S4U): task hanya menjalankan aplikasi di PC ini.
#
# Daftar aplikasi yang dijalankan = hasil "pm2 save" terakhir. Setelah menambah/menghapus aplikasi
# di PM2, jalankan "pm2 save" lagi.

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$taskName = 'WhatsOrbit (PM2)'
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
$dump = Join-Path $env:USERPROFILE '.pm2\dump.pm2'

try {
    if (-not (Test-Path $pm2)) { throw "PM2 tidak ditemukan di $pm2" }
    if (-not (Test-Path $dump)) { throw "Daftar aplikasi PM2 belum disimpan. Jalankan 'pm2 save' dulu." }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$pm2' resurrect`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT1M'
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null

    $t = Get-ScheduledTask -TaskName $taskName
    Write-Host ""
    Write-Host "Berhasil. Task '$taskName' sekarang:" -ForegroundColor Green
    Write-Host "  Pemicu : saat PC menyala (+1 menit), tanpa perlu login"
    Write-Host "  Akun   : $($t.Principal.UserId) ($($t.Principal.LogonType))"
    # dump.pm2 punya kunci ganda (username/USERNAME) sehingga ConvertFrom-Json gagal: ambil nama saja
    $apps = (Select-String -Path $dump -Pattern '"name"\s*:\s*"([^"]+)"' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    Write-Host "  Isi    : $($apps -join ', ')"
}
catch {
    Write-Host ""
    Write-Host "Gagal: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""
Read-Host "Tekan Enter untuk menutup"
