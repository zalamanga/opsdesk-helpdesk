# Menjelaskan dan mendemokan OpsDesk

OpsDesk adalah proyek portofolio helpdesk TI dengan dua peran, antrean tiket, penugasan agen, percakapan publik/internal, SLA, riwayat perubahan, dan export CSV. Gunakan contoh latihan saat presentasi. Jangan menyebut data seed sebagai data perusahaan atau hasil penggunaan pelanggan.

## Persiapan sebelum demo

Jalankan Docker Desktop, lalu buka PowerShell pada root repo:

```powershell
Set-Location 'D:\kerjaan\done push repo\opsdesk-helpdesk'
.\scripts\Start.ps1
```

Build pertama membutuhkan unduhan dan tidak termasuk waktu presentasi lima menit. Sesudah build tersedia, `Start.ps1 -NoBuild` memakai image yang sudah dibangun. Perubahan source memerlukan build kembali.

Buka `http://localhost:8091`, atau port yang dipilih pada `.env`. Akun latihan ada pada `.local\LOCAL-CREDENTIALS.txt`. File tersebut memuat password privat lokal dan tidak untuk dibagikan atau diunggah ke GitHub. Mengubah password pada `.env` tidak mengganti password akun yang sudah dibuat seed.

Siapkan dua sesi browser terpisah: jendela biasa sebagai `requester@opsdesk.test` dan jendela privat sebagai `agent@opsdesk.test`. Keduanya memakai password latihan lokal. Pisahkan sesi agar login satu akun tidak mengganti cookie akun lainnya.

Sebelum presentasi, pastikan login bekerja, antrean tampil, dan layar tidak memperlihatkan `.env` atau berkas kredensial. Pilih satu tiket baru berlabel `[Demo]` agar mudah diikuti. Demo menyimpan transaksi; seed berikutnya tidak mereset tiket yang sudah diubah.

## Urutan demo lima menit

| Waktu | Tindakan pada layar | Penjelasan yang menyertainya |
| --- | --- | --- |
| 0:00-0:40 | Masuk sebagai pemohon, tunjukkan **Tiket saya** dan **Buat tiket**. | Pemohon hanya dapat membaca tiket miliknya. Backend memasukkan identitas dari sesi, sehingga client tidak memilih pemilik tiket sesuka hati. |
| 0:40-1:25 | Buat `[Demo] Printer tim tidak terhubung`, deskripsi yang cukup, kategori perangkat, prioritas tinggi. | Tiket mendapat deadline respons satu jam dan penyelesaian delapan jam. Keduanya disimpan saat pembuatan dan dihitung 24/7. |
| 1:25-2:10 | Pindah ke agen, tekan **Perbarui**, pilih tiket, pilih agen bertanda `(saya)`, **Simpan penugasan**, lalu **Mulai kerjakan**. | Pengambilan tugas mencatat penanggung jawab. Agen harus memiliki tugas sebelum mulai atau menyelesaikan tiket. Penugasan saja belum memenuhi SLA respons. |
| 2:10-3:00 | Kirim catatan internal, kemudian balasan publik. Kembali sebentar ke pemohon dan perbarui detail. | Pemohon menerima balasan publik. Catatan internal dan event internal disaring backend. Balasan publik pertama dari agen lain mengisi waktu respons pertama satu kali. |
| 3:00-3:45 | Sebagai agen, tulis ringkasan solusi minimal 10 karakter dan selesaikan tiket. | Penyelesaian mencatat waktu, balasan publik, dan event dalam transaksi yang sama. Riwayat tetap dapat dilihat. |
| 3:45-4:20 | Sebagai pemohon, buka kembali dengan alasan minimal 10 karakter. | Reopen memakai deadline awal dan mempertahankan respons pertama. Membuka tiket berulang tidak memberikan SLA baru. |
| 4:20-5:00 | Tunjukkan filter, ringkasan sebelum filter, dan **Ekspor CSV**. Buka panduan arsitektur/kode. | Export memakai hasil filter yang dapat diakses, meliputi semua halaman, dan membatasi jumlah baris. Jelaskan satu keputusan teknis yang dapat ditunjukkan pada source. |

Apabila panel menyatakan data berubah, tekan **Muat versi terbaru**, periksa hasil terbaru, lalu kirim lagi tindakan yang masih sesuai. Konflik tidak berarti teks draf harus hilang.

## Penjelasan pembuka

Contoh berikut merupakan bahan latihan. Sesuaikan kata-katanya dengan bagian kode yang sudah Anda pelajari dan kontribusi yang benar-benar Anda kerjakan.

> Proyek ini mencatat kendala TI supaya pemohon dapat mengikuti penanganannya dan agen mempunyai antrean tugas yang jelas. Frontend memakai React dan TypeScript. Backend FastAPI menangani sesi, hak akses, alur status, serta SLA. PostgreSQL menyimpan tiket, percakapan, dan event. Semua layanan berjalan melalui Docker Compose, dengan Nginx sebagai pintu masuk browser. Bagian yang saya pelajari lebih dalam adalah pengaturan perubahan bersamaan: setiap tindakan membawa versi tiket, lalu backend memeriksanya di dalam transaksi sebelum menyimpan.

Jangan menghafal klaim yang belum bisa Anda tunjukkan. Buka file yang sesuai saat menjawab: [CODE-GUIDE.md](CODE-GUIDE.md) memetakan fungsi dan tanggung jawabnya.

## Pertanyaan teknis yang layak dilatih

### Mengapa memakai sesi cookie?

Aplikasi browser ini memakai satu origin. Backend membuat token acak, menyimpan hash token pada database, dan mengirim token melalui cookie HttpOnly. Server dapat mencabut sesi saat logout. Frontend memulihkan identitas melalui `/api/auth/me` dan tidak menyimpan token sesi di localStorage. Pendekatan ini membutuhkan pembacaan sesi di server serta perlindungan CSRF untuk request perubahan.

Tunjukkan `login()`, `get_auth()`, `mutation_auth()`, dan `logout()` pada [main.py](../backend/app/main.py), lalu `request()` pada [api.ts](../frontend/src/api.ts).

### Apa bedanya autentikasi dengan otorisasi?

Autentikasi memeriksa siapa pengguna melalui sesi. Otorisasi memeriksa apakah pengguna tersebut boleh membaca tiket atau menjalankan tindakan. Role agen tidak otomatis membuat semua transisi sah; untuk mulai/resolve agen harus mengambil tugas tersebut terlebih dahulu.

`accessible()` membatasi query tiket pemohon, `ticket_detail()` menyaring isi internal, dan `require_agent()` memeriksa role. Pengujian juga mengirim request langsung ke API, sehingga aturan tidak bergantung pada tombol yang terlihat.

### Mengapa ada CSRF dan pemeriksaan Origin?

Browser mengirim cookie secara otomatis. Request perubahan harus menyertakan token CSRF milik sesi melalui header. Middleware juga menolak Origin yang tidak terdaftar dan request cross-site yang ditandai browser. Daftar Origin berupa nilai tepat, tanpa wildcard. Token CSRF disimpan dalam memori frontend dan dipulihkan bersama sesi setelah reload.

Cookie Secure diaktifkan sesuai lingkungan. Demo HTTP lokal memakainya dalam keadaan nonaktif; publikasi HTTPS memerlukan konfigurasi yang sesuai.

### Mengapa butuh lock dan versi sekaligus?

Kunci baris mengatur urutan transaksi yang menulis tiket sama. Versi memeriksa apakah keputusan pengguna dibuat berdasarkan isi tiket yang masih berlaku. Dua agen yang membaca versi 4 tidak boleh sama-sama menulis seolah tidak ada perubahan. Penulis pertama mengubah tiket menjadi versi 5; permintaan kedua dengan versi 4 menerima 409 dan perlu memuat ulang.

Tunjukkan `locked_ticket()`, `commit_ticket()`, serta `Ticket.__mapper_args__`. Pengujian PostgreSQL menggunakan dua client dan memeriksa satu keberhasilan, satu konflik, satu kenaikan versi, dan satu tambahan event. Jalur pengujian ini memerlukan PostgreSQL khusus; kelulusan SQLite saja tidak membuktikan kunci baris PostgreSQL.

### Apa yang terjadi jika penambahan riwayat gagal?

Perubahan tiket, komentar, dan event memakai sesi/transaksi yang sama. Jika penyimpanan gagal sebelum commit, perubahan ikut rollback. Test `test_failed_audit_write_rolls_back_comment_response_time_and_version` sengaja menimbulkan kegagalan saat audit ditulis, lalu memeriksa tiket melalui API dan database.

Riwayat aplikasi ini belum menggunakan tanda tangan kriptografis. Administrator database tetap berada di luar batas perlindungan yang disediakan API.

### Bagaimana SLA dihitung?

Prioritas menentukan durasi respons/penyelesaian. Keduanya dihitung dari pembuatan tiket, terus berjalan termasuk akhir pekan, dan tidak dijeda selama pengerjaan. Penyelesaian tepat di deadline masih tepat waktu. Tiket yang belum selesai tepat di deadline masih pending; satu detik sesudahnya lewat SLA.

Respons pertama berasal dari komentar publik agen selain pembuat permintaan. Catatan internal, assignment, dan balasan pembuat tiket tidak menghitung sebagai respons pertama. Jika agen membuat tiket untuk dirinya sendiri, balasan agen tersebut juga tidak memenuhi respons pertama. Resolve oleh agen lain dapat menjadi respons pertama bila belum ada balasan publik sebelumnya.

Reopen mempertahankan deadline dan respons pertama. Karena itu, tiket yang dibuka kembali setelah deadline langsung berstatus melewati SLA penyelesaian. Tunjukkan `snapshot()` pada [sla.py](../backend/app/sla.py).

### Mengapa polling, belum memakai WebSocket?

Frontend mengambil antrean dan detail setiap 15 detik ketika tab terlihat. Pengguna dapat memperbarui secara manual. Kebutuhan demo belum memerlukan koneksi push dan pengelolaan reconnect tambahan. Pembaruan lintas pengguna bisa terlambat sampai polling berikutnya; versi tiket tetap diperiksa ketika menyimpan.

### Apa perbedaan count, filter, dan pagination?

Count menunjukkan seluruh antrean yang dapat diakses sebelum filter. Daftar tiket mengikuti filter dan halaman saat ini. Export mengikuti filter, mengambil seluruh halaman, dan menolak hasil melebihi 10.000 tiket. Jumlah respons/solusi lewat SLA juga mencakup tiket yang selesai terlambat sebagai riwayat antrean.

### Apa yang dilakukan Docker?

Compose mengatur tiga layanan: web, API, dan database. Dockerfile backend menyiapkan Python/dependensi serta kode API. Dockerfile web membangun frontend lalu menyalin hasil build ke Nginx. Database memakai volume agar data bertahan ketika container dihentikan. Pengujian mempunyai proyek Compose terpisah dan database tmpfs.

Docker tidak otomatis menyelesaikan backup, HTTPS, kapasitas produksi, atau pembaruan dependensi. Hal-hal itu tetap memerlukan konfigurasi dan verifikasi.

### Bagaimana menguji hasilnya?

Pengujian backend lengkap menghasilkan **58 passed**, termasuk regresi balasan pada tiket sendiri, pembatas login per email/shared IP, serta konkurensi PostgreSQL 17 pada database uji sementara. Pengujian tersebut berjalan melalui:

```powershell
.\scripts\Test.ps1
```

Lihat hasil proses tersebut atau CI untuk menyatakan kelulusan PostgreSQL. Jangan menyimpulkannya dari hasil lokal yang melewati pengujian PostgreSQL. [test-plan.md](test-plan.md) menjelaskan perilaku yang diperiksa; test frontend memeriksa format dan timeline, sedangkan pemeriksaan browser memastikan alur yang dipakai saat demo.

## Batas yang perlu dijelaskan

Proyek ini mendemonstrasikan satu organisasi dan dua role. Saat ini belum ada multi-tenant, SSO/MFA, registrasi/reset password publik, email, unggahan, kalender jam kerja, atau fitur AI. Akun dibuat operator melalui CLI. Seed hanya membuat data sintetis satu kali dan tidak menimpa transaksi setelahnya.

Belum ada bukti kapasitas beban produksi atau availability tertentu. Sebelum digunakan publik, pekerjaan berikutnya mencakup HTTPS dan Secure cookie, pengelolaan secret, sumber IP yang dipercaya di balik proxy, backup yang diuji restore, pemantauan error, serta pengukuran beban. Sebutkan kebutuhan tersebut sebagai pekerjaan berikutnya, bukan fitur yang sudah selesai.

Jika membahas bantuan alat saat pembuatan, jelaskan dengan jujur bagian yang dibantu, perubahan yang Anda tinjau, dan pengujian yang Anda jalankan. Interviewer dapat meminta perubahan kecil langsung di kode; latihan terbaiknya adalah mengikuti satu request hingga tersimpan, kemudian menjalankan test yang terkait.

Sesudah demo, hentikan hanya layanan proyek ini:

```powershell
.\scripts\Stop.ps1
```

Perintah tersebut mempertahankan data pada volume PostgreSQL.
