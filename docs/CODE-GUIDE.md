# Membaca kode OpsDesk

Mulai dari satu tindakan: pemohon membuat tiket, lalu agen membalasnya. Frontend mengirim JSON, backend memeriksa sesi dan aturan, database menyimpan perubahan, dan frontend menampilkan hasil respons. Panduan ini menunjuk file serta fungsi yang mengerjakan setiap bagian.

Rincian bentuk JSON ada di [API-CONTRACT.md](API-CONTRACT.md). Diagram layanan dan database ada di [ARCHITECTURE.md](ARCHITECTURE.md). Gunakan [INTERVIEW.md](INTERVIEW.md) untuk latihan presentasi.

## Peta file backend

Semua path pada tabel dihitung dari root repo.

| File | Masukan | Hasil dan tanggung jawab |
| --- | --- | --- |
| [backend/app/config.py](../backend/app/config.py) | Environment atau argumen `Settings` | Konfigurasi koneksi, Origin, cookie, mode latihan, masa sesi, serta batas login. Menolak wildcard Origin dan batas waktu yang tidak positif. |
| [backend/app/db.py](../backend/app/db.py) | URL database | `Database.engine` dan `session_factory`. SQLite mengaktifkan foreign key; PostgreSQL memakai driver psycopg. `dispose()` menutup pool saat pengelola database selesai. |
| [backend/app/models.py](../backend/app/models.py) | Nilai kolom yang akan disimpan | Definisi tabel, relasi, indeks, constraint, konversi waktu UTC, dan pemeriksaan versi ORM. |
| [backend/app/schemas.py](../backend/app/schemas.py) | JSON dari client | Model Pydantic untuk login, tiket, komentar, assignment, dan transisi. Field tambahan ditolak; versi berupa integer ketat dan `internal` berupa boolean ketat. |
| [backend/app/security.py](../backend/app/security.py) | Password atau token | Hash/verifikasi Argon2 password, token acak, dan SHA-256 token sesi. |
| [backend/app/sla.py](../backend/app/sla.py) | Prioritas, deadline, waktu selesai, waktu sekarang | Kebijakan durasi serta snapshot status SLA. Tidak mengakses database atau jam browser. |
| [backend/app/main.py](../backend/app/main.py) | HTTP request dan dependency database/sesi | Middleware, otorisasi, endpoint, query antrean, perubahan tiket, audit, dan export CSV. |
| [backend/app/seed.py](../backend/app/seed.py) | Sesi database, password latihan, satu waktu UTC | Data latihan berlabel dan penanda seed. Mengembalikan `True` bila baru dibuat atau `False` bila sebelumnya sudah selesai. Caller melakukan commit/rollback. |
| [backend/app/cli.py](../backend/app/cli.py) | Perintah operator dan environment password | Migrasi database, pembuatan akun, serta pemanggilan seed dalam transaksi. Tidak menyediakan registrasi publik. |

`models.py` menjelaskan struktur objek pada aplikasi. [alembic/versions/0001_initial.py](../backend/alembic/versions/0001_initial.py) menjelaskan pembuatan skema database awal. Perubahan struktur berikutnya perlu revisi Alembic baru; mengubah class model saja tidak memperbarui database yang sudah berjalan.

## Dari formulir ke tiket baru

Pemohon menekan **Buat tiket**. [CreateTicket.tsx](../frontend/src/CreateTicket.tsx) membuka elemen dialog, membaca judul/deskripsi/kategori/prioritas, lalu memanggil `api.create()`. Dialog menampilkan kegagalan dan mempertahankan isian jika permintaan belum berhasil.

Contoh payload berikut hanya ilustrasi:

```json
{
  "title": "Printer lantai dua tidak terhubung",
  "description": "Printer tidak terdeteksi dari komputer tim sejak pagi ini.",
  "category": "hardware",
  "priority": "high"
}
```

`request()` pada [api.ts](../frontend/src/api.ts) mengirim ke `/api/tickets` dengan JSON, cookie same-origin, serta `X-CSRF-Token`. Backend `NewTicket` memvalidasi ukuran dan nilai isian. Pengirim tidak boleh menyisipkan `requester_id`, `status`, atau deadline karena field tersebut tidak ada pada schema pembuatan.

Endpoint `create_ticket()` mengambil satu waktu server, mencari durasi pada `POLICY`, lalu mengisi:

```python
response_due_at = now + response_delta
resolution_due_at = now + resolution_delta
```

`requester_id` berasal dari sesi. Backend menyimpan tiket dan event pembuatan dalam satu transaksi, lalu mengembalikan detail dengan HTTP 201. `onCreated`/callback frontend memilih tiket hasil pembuatan dan memperbarui antrean.

## Sesi dan pemeriksaan request

Fungsi berikut berada di [main.py](../backend/app/main.py).

| Fungsi | Masukan | Hasil atau penolakan |
| --- | --- | --- |
| `create_app(settings, database, clock)` | Konfigurasi, database opsional, fungsi jam | Aplikasi FastAPI dengan dependency yang bisa diganti pada test. Instans global `app` dipakai Uvicorn. |
| `request_guards()` | Header, metode, body HTTP | Memeriksa Origin tepat, cross-site, batas body 64 KiB, dan JSON untuk body perubahan; menambahkan header respons. |
| `get_db()` | Request | Sesi SQLAlchemy per request yang ditutup setelah dependency selesai. |
| `get_auth()` | Cookie `opsdesk_session` | Sesi aktif beserta pengguna; menolak cookie tidak dikenal, sesi kedaluwarsa, atau pengguna nonaktif dengan 401. |
| `mutation_auth()` | Sesi aktif dan header CSRF | Sesi yang boleh melanjutkan mutasi; token hilang/tidak cocok menghasilkan 403. |
| `consume_login_attempt()` | IP, email, waktu, pengaturan | Hitungan atomik per jendela pada database. Jika IP/email melebihi batas, mengembalikan 429 beserta `Retry-After`. |
| `session_response()` | Objek sesi dan konfigurasi | Identitas pengguna, token CSRF, serta status mode latihan. Password hash dan token sesi tidak masuk JSON ini. |
| `login()` | Email/password | Memverifikasi password, mencabut cookie lama bila ada, membuat sesi baru dan cookie HttpOnly. |
| `me()` | Sesi aktif | Identitas dan token CSRF untuk memulihkan keadaan frontend setelah reload. |
| `logout()` | Sesi aktif dan CSRF | Menghapus sesi server dan cookie, lalu mengembalikan 204. |

`security.py` memisahkan empat tugas: `hash_password()` membuat hash Argon2, `verify_password()` memeriksanya, `new_token()` membuat nilai acak, dan `token_hash()` membuat digest token sesi. SHA-256 token acak tidak dipakai sebagai pengganti Argon2 untuk password pengguna.

Sesi secara bawaan berakhir 24 jam sejak login. Pembatas login secara bawaan memakai 8 percobaan per email serta 64 per IP setiap jendela tetap 15 menit. Login berhasil ikut dihitung. Aplikasi yang dipublikasikan di balik proxy perlu penetapan IP client/trusted proxy sesuai topologi; lihat batas pada panduan arsitektur.

## Membaca antrean tanpa membocorkan tiket

| Fungsi pada `main.py` | Peran |
| --- | --- |
| `accessible(user)` | Menghasilkan syarat `requester_id == user.id` untuk pemohon; agen mengakses seluruh tiket. |
| `load_ticket()` | Membaca tiket dengan syarat akses yang sama; pilihan `lock=True` menambahkan kunci baris. Tiket tidak ada/tidak dapat diakses menghasilkan 404. |
| `queue_filters()` | Menggabungkan akses dengan pencarian, status, prioritas, assignment, dan SLA. Karakter wildcard pencarian di-escape agar diperlakukan sebagai teks. |
| `response_breached()` / `resolution_breached()` | Membentuk syarat SQL untuk pekerjaan yang lewat deadline atau selesai terlambat. |
| `queue_order()` | Mendahulukan tiket aktif, kemudian prioritas tertinggi, waktu pembuatan tertua, dan ID. |
| `queue_counts()` | Menghitung ringkasan seluruh tiket yang dapat diakses, sebelum filter halaman. |
| `person()` | Menghasilkan identitas ringkas `{id, name}`. |
| `ticket_summary()` | Menyatukan data tiket dan dua snapshot SLA menjadi item antrean. |
| `ticket_detail()` | Menambahkan deskripsi, komentar, dan event; catatan/event internal dibuang untuk pemohon. |
| `tickets()` / `detail()` | Mengambil data, memakai satu waktu untuk seluruh SLA dalam respons, dan mengembalikan JSON. |
| `agents()` | Mengembalikan agen aktif untuk pilihan penugasan. Endpoint ini hanya untuk role agen. |

Pagination membatasi item yang diambil. Ringkasan tidak berubah hanya karena pengguna mencari satu judul. Relasi pemohon/agen antrean dan export dimuat bersama query untuk menghindari query tambahan per item.

## Penugasan, balasan, dan transisi

`locked_ticket()` membaca tiket yang dapat diakses dengan kunci baris, lalu membandingkan `expected_version`. `audit()` menambahkan event pada sesi database yang sama. `commit_ticket()` menaikkan versi, memperbarui `updated_at`, melakukan commit, dan memuat ulang relasi hasil perubahan.

Contoh berikut berarti pengguna menyusun balasan berdasarkan versi 4:

```json
{
  "expected_version": 4,
  "body": "Kami sedang memeriksa koneksi printer tersebut.",
  "internal": false
}
```

| Endpoint/fungsi | Aturan yang diperiksa | Perubahan tersimpan |
| --- | --- | --- |
| `/assign`, `assign()` | Agen, tiket aktif, tujuan agen aktif atau kosong, assignment benar-benar berubah | Penanggung jawab dan event penugasan. |
| `/comments`, `comment()` | Tiket aktif; catatan internal hanya oleh agen | Komentar dan event. Respons publik pertama dari agen selain pembuat permintaan mengisi `first_response_at` satu kali. |
| `/transition`, `transition()` | Pasangan transisi yang sah, role, kepemilikan tugas, serta panjang alasan | Status, waktu penyelesaian, komentar publik untuk resolve/reopen, dan event. |

Alurnya `open -> in_progress -> resolved -> open`. Agen harus mengambil tugas sebelum mulai/menyelesaikan tiket. Resolve dan reopen memerlukan penjelasan minimal 10 karakter. Reopen dapat dilakukan pemohon pemilik tiket atau agen, mempertahankan deadline awal dan respons pertama, serta menghapus waktu penyelesaian saat ini.

Agen yang membuat tiket untuk dirinya sendiri tetap berposisi sebagai pembuat permintaan pada perhitungan SLA respons. Balasan atau catatan resolve miliknya tidak menjadi respons pertama; agen lain perlu memberi respons publik.

`expected_version` yang tertinggal menghasilkan 409. Payload yang tidak valid menghasilkan 422. Pelanggaran role/kepemilikan menghasilkan 403. Kegagalan validasi tidak menambah versi, komentar, atau event. Pengujian sengaja menggagalkan penyimpanan audit dan memeriksa bahwa komentar, versi, serta waktu respons ikut rollback.

## Cara membaca SLA

`POLICY` pada [sla.py](../backend/app/sla.py) memetakan prioritas ke dua `timedelta`. `snapshot(due_at, completed_at, now)` tidak membaca jam sendiri, sehingga pengujian bisa mengatur batas waktu secara tepat.

| Kondisi | Hasil |
| --- | --- |
| Belum selesai, waktu masih sebelum/tepat deadline | `pending` |
| Belum selesai, waktu sudah melewati deadline | `breached` |
| Selesai sebelum/tepat deadline | `met` |
| Selesai setelah deadline | `breached` |

`remaining_seconds` bernilai deadline dikurangi waktu sekarang untuk pekerjaan belum selesai. Untuk pekerjaan selesai, nilainya deadline dikurangi waktu selesai dan tidak terus berkurang. Nilai negatif menunjukkan keterlambatan. Semua durasi berjalan 24/7 dalam UTC; frontend memformat tanggal menurut zona waktu browser.

## Export CSV

`export()` memakai syarat akses dan filter yang sama dengan antrean, mengambil seluruh hasil filter, serta menolak lebih dari 10.000 tiket. Pemeriksaan jumlah dilakukan sebelum penulisan CSV dan terhadap hasil query terbatas untuk menghindari file terpotong diam-diam bila antrean bertambah di antara kedua query.

`csv.writer` menangani koma, tanda kutip, dan baris baru. `csv_cell()` memberi awalan apostrof pada nilai yang bisa dibaca spreadsheet sebagai formula, termasuk awalan `=`, `+`, `-`, `@`, tab, dan baris baru tertentu. Export tidak menyertakan isi catatan internal.

## Peta file frontend

| File | Tugas |
| --- | --- |
| [main.tsx](../frontend/src/main.tsx) | Memasang root React dan stylesheet. |
| [types.ts](../frontend/src/types.ts) | Bentuk TypeScript sesi, filter, tiket, komentar, event, serta respons antrean. |
| [api.ts](../frontend/src/api.ts) | `request()` mengirim JSON/cookie/CSRF; `check()` mengubah error menjadi `ApiError`; `queryString()` membentuk filter; `api.export()` mengunduh CSV. Respons 401 memicu event sesi berakhir. |
| [App.tsx](../frontend/src/App.tsx) | Login, pemulihan sesi, antrean/filter, pagination, polling, pemilihan tiket, export, dan logout. `loadQueue()`/`loadDetail()` memakai pembatalan request dan nomor urut agar respons lama tidak menggantikan pilihan terbaru. |
| [CreateTicket.tsx](../frontend/src/CreateTicket.tsx) | Dialog pembuatan tiket, validasi formulir, pengiriman, serta pengembalian fokus ke pemicu dialog. |
| [TicketPanel.tsx](../frontend/src/TicketPanel.tsx) | Detail, assignment, balasan/catatan, resolve/reopen, versi editor, dan konflik 409. `reloadLatest()` memuat versi terbaru sambil mempertahankan teks yang belum dikirim. |
| [format.ts](../frontend/src/format.ts) | Label Bahasa Indonesia, format tanggal/durasi/SLA, dan penggabungan komentar/event menjadi timeline terurut. |
| [ui.tsx](../frontend/src/ui.tsx) | Tampilan pesan error/status dan label SLA yang dipakai ulang. |
| [styles.css](../frontend/src/styles.css) | Layout antrean/detail, keadaan interaksi, fokus keyboard, serta penyesuaian ukuran layar. |

`editorVersion` pada panel sengaja tidak otomatis mengikuti setiap pembaruan polling. Jika pengguna sedang menulis dan agen lain mengubah tiket, panel dapat memperlihatkan data lebih baru sambil meminta pengguna memuat versi terbaru sebelum mengirim perubahan berdasarkan versi lama. Teks belum terkirim tetap tersedia untuk ditinjau.

## Infrastruktur dan pengujian

| File/folder | Tugas |
| --- | --- |
| [compose.yml](../compose.yml) | Layanan web/API/PostgreSQL, jaringan internal, health check, volume database, dan batas memori demo. |
| [deploy/nginx.conf](../deploy/nginx.conf) | Menyajikan SPA dan meneruskan `/api`; membatasi ukuran request serta menambahkan header browser. |
| [backend/entrypoint.sh](../backend/entrypoint.sh) | Migrasi, seed opsional, lalu proses Uvicorn. |
| [scripts/Common.ps1](../scripts/Common.ps1) | Root proyek, secret acak lokal, serta pemanggilan Compose dengan nama proyek tetap. |
| [scripts/Start.ps1](../scripts/Start.ps1) | Membuat konfigurasi privat bila belum ada dan menyalakan layanan sampai health check siap. |
| [scripts/Stop.ps1](../scripts/Stop.ps1) | Menghentikan container proyek sambil mempertahankan volume database. |
| [scripts/Test.ps1](../scripts/Test.ps1) dan [compose.test.yml](../compose.test.yml) | Proyek Compose test bernama unik dan PostgreSQL test pada tmpfs; dibersihkan melalui `finally`. |
| [backend/tests](../backend/tests) | Kontrak HTTP, kontrol waktu, otorisasi, transaksi, export, seed, dan perlombaan dua client PostgreSQL. |
| [frontend/src/format.test.ts](../frontend/src/format.test.ts) | Format durasi, batas waktu, dan urutan timeline. |

Pengujian lengkap melalui `scripts/Test.ps1` menghasilkan **58 passed**, termasuk perlombaan transaksi pada PostgreSQL 17 yang terpisah dari database aplikasi. Jalur PostgreSQL memerlukan `OPSDESK_TEST_DATABASE_URL`; bila hanya menjalankan tes SQLite tanpa variabel tersebut, pengujian konkurensi dilewati. Lingkup pemeriksaan ada di [test-plan.md](test-plan.md).
