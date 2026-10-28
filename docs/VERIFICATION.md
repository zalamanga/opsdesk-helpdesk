# Hasil verifikasi OpsDesk

Diperiksa pada 28 Oktober 2026. Hasil di bawah berasal dari source proyek yang dijalankan, bukan estimasi kapasitas atau sertifikasi keamanan.

| Pemeriksaan | Hasil | Cara memeriksa ulang |
| --- | --- | --- |
| Backend | 58 pengujian lulus, termasuk konkurensi PostgreSQL 17 | `scripts/Test.ps1` |
| Frontend | 4 unit test lulus | `cd frontend`, lalu `npm test` |
| Build web | TypeScript strict dan build Vite lulus, termasuk build image Nginx | `npm run build` atau `scripts/Start.ps1` |
| Workflow browser | 8 kasus lulus: autentikasi, create, workflow lintas peran, konflik/draf, filter/CSV/pagination, mobile, loading/error, serta kontras/reflow | `npm run test:e2e` |
| Capture | Satu kasus capture menghasilkan lima screenshot aplikasi nyata | `npm run screenshots` |
| Docker | Migrasi, seed awal, healthcheck database/API/web, dan restart tanpa menimpa data berjalan | `scripts/Start.ps1` |
| Script Windows | Sintaks PowerShell valid dan Start/Test dijalankan pada Windows PowerShell 5 | `scripts/Start.ps1`, `scripts/Test.ps1` |

Backend dijalankan pada Python 3.13. PostgreSQL untuk uji race berjalan pada container sementara ber-tmpfs dalam proyek Compose terpisah. Container dan jaringan tes dibersihkan setelah selesai. Tes biasa memakai SQLite terisolasi dan clock UTC yang dapat dikendalikan. Pengujian race memakai dua client berbeda pada PostgreSQL dan membuktikan satu sukses, satu HTTP 409, satu kenaikan versi, serta satu tambahan event.

Pemeriksaan browser lokal menggunakan Microsoft Edge melalui Playwright pada aplikasi React/Nginx + FastAPI + PostgreSQL. CI menggunakan Chromium. Kasus workflow memakai HTTP nyata; kegagalan jaringan dan jeda loading/reload sengaja disimulasikan melalui intersepsi browser untuk memeriksa state pemulihan. Screenshot tidak memakai respons API tiruan.

Kasus konflik memeriksa bahwa draf tidak hilang setelah 409. Selama pengambilan versi terbaru ditunda, tombol kirim harus nonaktif. Sesudah data terbaru dimuat, draf yang sama dapat dikirim memakai versi baru. Ini memeriksa perilaku pengguna saat jaringan lambat, bukan hanya hasil endpoint.

## Tampilan dan akses

- Lebar 320, 390, 768, dan 1440 px diperiksa untuk overflow horizontal.
- Keyboard diuji melalui Enter, Escape, fokus judul formulir, dan pengembalian fokus ke tombol pembuka dialog.
- Pemeriksaan teks yang dirender memakai batas kontras 4,5:1 untuk teks biasa dan 3:1 untuk teks besar. Palet kontrol dan fokus juga diperiksa. Ini bukan klaim audit WCAG menyeluruh.
- Kelima screenshot diperiksa visual untuk teks terpotong, tabrakan elemen, dan keterbacaan. Data latihan selalu diberi label; angka antrean berasal dari database.
- [Laporan gate Antislop](UX-REVIEW.md) mencatat aturan, keputusan desain, dan bukti pemeriksaan.

## CI

[Workflow Verify OpsDesk](https://github.com/zalamanga/opsdesk-helpdesk/actions/workflows/verify.yml) menjalankan backend dengan PostgreSQL, unit/build frontend, kemudian workflow browser pada stack Docker. Gunakan status run dan commit yang ditampilkan GitHub untuk memeriksa hasil remote; tabel di atas adalah bukti lokal.

## Batas bukti

Belum dilakukan load test, audit penetrasi, pengujian restore backup, atau pengukuran availability. Tidak ada email/unggahan/SSO/kalender bisnis yang dapat diuji karena fitur tersebut tidak diimplementasikan. Kontras otomatis memeriksa teks yang terlihat pada state uji, bukan seluruh kombinasi browser, ekstensi, atau pengaturan OS.

Dependensi Starlette memberi peringatan deprecation untuk adaptor TestClient/httpx pada tes. Pada image test nonroot, pytest juga tidak menulis cache pada `/app`; ini tidak mengubah hasil 58 tes. Trace dan laporan browser bersifat lokal serta diabaikan Git karena dapat mengandung sesi dan payload pengujian.
