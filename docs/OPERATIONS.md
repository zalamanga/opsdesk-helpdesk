# Operasi OpsDesk

## Container dan data

`compose.yml` menjalankan PostgreSQL 17, API FastAPI pada port internal 8000, dan Nginx yang melayani hasil build React. Hanya Nginx menerbitkan port loopback `8091`. Volume `opsdesk_postgres_data` menyimpan database untuk nama proyek Compose `opsdesk`.

`Start.ps1` membuat `.env` dan `.local/LOCAL-CREDENTIALS.txt` hanya bila `.env` belum ada, menjalankan build, kemudian menunggu healthcheck. API melakukan migrasi Alembic sebelum menerima HTTP dan menjalankan seed hanya bila `OPSDESK_SEED_DEMO=true`. Satu worker dipakai pada contoh ini. Seed memakai marker dan transaksi sehingga restart tidak mereset tiket/sandi yang sudah ada.

`Stop.ps1` hanya menghentikan container proyek. Jangan memakai `down --volumes` bila data masih dibutuhkan. File backup database mengandung data akun, hash sandi, sesi dan tiket; simpan secara privat, di luar Git.

## Konfigurasi manual

Salin `.env.example` menjadi `.env`. Ganti kedua placeholder sandi dengan nilai acak yang berbeda dan setidaknya 12 karakter; gunakan karakter heksadesimal untuk sandi database agar tidak memerlukan encoding URL. Jangan memakai placeholder dari contoh sebagai sandi operasional.

```text
OPSDESK_HTTP_PORT=8091
OPSDESK_DB_PASSWORD=<sandi database acak>
OPSDESK_DEMO_PASSWORD=<sandi latihan acak>
OPSDESK_DEMO_MODE=true
OPSDESK_SEED_DEMO=true
OPSDESK_COOKIE_SECURE=false
```

```bash
docker compose --project-name opsdesk --env-file .env up --build -d --wait
docker compose --project-name opsdesk --env-file .env stop
```

Di Windows, script memakai parameter `--project-name`, `--project-directory`, `--file`, dan `--env-file` yang eksplisit. Script memeriksa exit code Docker; progres pada stderr tidak dianggap kegagalan hanya karena Windows PowerShell 5 membungkusnya sebagai `ErrorRecord` ketika output dialihkan.

Jika port diganti, browser harus memakai port baru. Default `OPSDESK_ALLOWED_ORIGINS` mengikuti port tersebut. Untuk domain berbeda, set daftar Origin lengkap melalui `.env`, dipisahkan koma tanpa wildcard.

## Akun di luar seed

Tidak ada endpoint pendaftaran publik. CLI mengambil sandi dari `OPSDESK_USER_PASSWORD`, bukan argumen proses. Contoh PowerShell dari root repo:

```powershell
$privatePassword = Read-Host 'Sandi akun baru' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privatePassword)
try {
    $env:OPSDESK_USER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    docker compose --project-name opsdesk exec -T -e OPSDESK_USER_PASSWORD api python -m app.cli create-user --email staf@example.com --name 'Staf TI' --role agent
    if ($LASTEXITCODE -ne 0) { throw 'Pembuatan akun gagal.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Item Env:OPSDESK_USER_PASSWORD -ErrorAction SilentlyContinue
}
```

Peran yang diizinkan adalah `agent` dan `requester`. CLI menolak alamat yang sudah terdaftar. Mengubah `OPSDESK_DEMO_PASSWORD` setelah seed pertama tidak mereset sandi pengguna.

## Pengembangan tanpa Docker

Backend menyediakan SQLite untuk latihan lokal dan tes cepat. Bukti konkurensi menggunakan PostgreSQL, karena SQLite tidak menerapkan row lock PostgreSQL.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
cd backend
..\.venv\Scripts\python.exe -m app.cli init-db
# Buat akun melalui CLI menggunakan OPSDESK_USER_PASSWORD.
$env:OPSDESK_ALLOWED_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173'
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Di terminal kedua, buka `frontend`, jalankan `npm ci` lalu `npm run dev -- --port 5173`. Vite meneruskan `/api` ke `127.0.0.1:8000`; `API_PROXY_TARGET` dapat mengganti tujuan pengembangan. Jangan menyalakan container dan server dev pada port yang sama.

## Sebelum dipasang pada server

Contoh Compose ditujukan untuk penggunaan lokal. Untuk domain server, sediakan reverse proxy HTTPS, ubah publikasi port sesuai jaringan yang dipakai, set `OPSDESK_COOKIE_SECURE=true`, dan set `OPSDESK_ALLOWED_ORIGINS=https://domain-yang-dipakai`. Nonaktifkan `OPSDESK_SEED_DEMO` dan `OPSDESK_DEMO_MODE` untuk instance berisi data operasional. Mulai dengan database kosong yang berbeda dari demo dan buat akun melalui CLI.

Origin bukan tempat menyimpan path: `https://helpdesk.example.com` benar; URL dengan `/login` bukan Origin. Tidak ada konfigurasi CORS wildcard.

API tidak mempercayai `X-Real-IP` atau `X-Forwarded-For` dari sembarang pengirim. Pembatasan login memakai identitas email dan alamat peer yang dilihat Uvicorn: 8 percobaan per email dan 64 per peer dalam jendela tetap 15 menit, termasuk login berhasil. Pada Compose ini, peer dapat berupa container Nginx sehingga kuota IP terbagi; kuota per-email tetap terpisah. Untuk skala lebih besar, konfigurasi trusted proxy dan pembatasan pada edge harus ditinjau sesuai jaringan sebenarnya. Lihat [panduan proxy FastAPI](https://fastapi.tiangolo.com/advanced/behind-a-proxy/).

## Memeriksa kegagalan

```powershell
docker compose --project-name opsdesk ps
docker compose --project-name opsdesk logs --tail 80 api
docker compose --project-name opsdesk logs --tail 80 db
```

`/api/health` memberikan 503 bila skema/database belum dapat dibaca. HTTP 401 berarti sesi tidak sah; 403 berarti peran, CSRF atau Origin ditolak; 404 juga dipakai untuk tiket milik pengguna lain; 409 berarti konflik versi/transisi; 422 berarti isian tidak sesuai kontrak; 429 berarti kuota login habis dan respons menyertakan `Retry-After`.

Saat melihat 409, muat versi terbaru dari tombol di detail. UI mempertahankan draf, tetapi draf belum menjadi bagian database sampai pengiriman berhasil. Draf berada di memori tab dan dapat hilang bila tab ditutup atau halaman di-reload.
