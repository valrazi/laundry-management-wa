# WhatsApp Gateway (Self-Hosted)

REST API WhatsApp berbasis **Baileys** yang berjalan sebagai proses Node.js terpisah.
Dibuat sebagai pengganti layanan pihak ketiga seperti Fonnte untuk **Sistem Informasi
Manajemen Laundry**, sehingga sistem dapat berjalan sepenuhnya di komputer lokal
tanpa bergantung pada kredit atau koneksi ke layanan eksternal.

Gateway ini **kompatibel dengan kontrak Fonnte** pada endpoint `/send`, sehingga
aplikasi laundry tidak perlu diubah sama sekali — cukup mengganti beberapa
environment variable.

---

## 1. Fitur

- Menautkan perangkat WhatsApp lewat scan QR (multi-device, seperti WhatsApp Web).
- Menyimpan sesi di disk, jadi QR hanya perlu di-scan sekali.
- Menyambung ulang otomatis saat koneksi terputus (dengan jeda bertingkat/bounded).
- Endpoint `POST /send` dengan bentuk request & respons yang sama seperti Fonnte.
- Balasan otomatis untuk chat masuk, maksimal sekali per nomor per hari (reset 00:00 WIB), dicatat di database.
- Halaman status web sederhana yang menampilkan kondisi koneksi dan QR.
- Mode simulasi (`MOCK_MODE`) untuk menguji integrasi tanpa WhatsApp sungguhan.
- Autentikasi API key.

---

## 2. Prasyarat

- **Node.js >= 20**
- **Git** (Baileys mengambil satu dependency dari repositori GitHub saat instalasi)
- **MySQL** — database yang sama dengan aplikasi laundry
- Akses internet (hanya untuk instalasi, dan untuk versi protokol WhatsApp web)
- Akun WhatsApp di ponsel untuk scan QR

> Tabel `auto_reply_logs` dibuat oleh migrasi Prisma di aplikasi laundry, bukan oleh
> gateway. Jalankan migrasinya lebih dahulu:
> `cd laundry-management && npx prisma migrate deploy`

---

## 3. Instalasi

```bash
cd whatsapp-gateway
npm install
```

## 4. Konfigurasi

Salin file contoh lalu sesuaikan:

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # Linux/macOS
```

Buat API key acak:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi `.env`:

| Variabel | Keterangan |
|---|---|
| `HOST` | Alamat bind. `127.0.0.1` = hanya lokal (disarankan). |
| `PORT` | Port HTTP gateway. Default `3001`. |
| `API_KEY` | Kunci rahasia. **Harus sama** dengan `FONNTE_TOKEN` di aplikasi laundry. |
| `SESSION_DIR` | Direktori sesi login. Default `auth_state`. |
| `LOG_LEVEL` | `silent`/`error`/`warn`/`info`/`debug`. Default `warn`. |
| `MOCK_MODE` | `true` = simulasi tanpa WhatsApp. Default `false`. |
| `DATABASE_URL` | Kredensial MySQL **yang sama** dengan aplikasi laundry. |
| `AUTO_REPLY_ENABLED` | `true` untuk mengaktifkan balasan otomatis. |
| `AUTO_REPLY_MESSAGE` | Template balasan otomatis. |
| `AUTO_REPLY_DELAY_MS` | Jeda sebelum membalas (ms). Default `3000`. |
| `TEST_TARGET` | Nomor tujuan untuk `npm run test:send`. |

> **Penting:** file `.env` dan folder `auth_state/` **tidak boleh** di-commit.
> Keduanya sudah masuk `.gitignore`.

---

## 5. Menjalankan

```bash
npm start
```

Output saat pertama kali dijalankan akan menampilkan **QR di terminal**:

```
[whatsapp] Buka WhatsApp > Perangkat Tertaut > Tautkan perangkat, lalu scan QR berikut:
```

Scan QR tersebut. Setelah berhasil akan muncul:

```
[whatsapp] Terhubung sebagai 62812xxxxxxx@s.whatsapp.net
```

Alternatif: buka `http://127.0.0.1:3001` di browser untuk melihat status dan QR.
Sesi tersimpan di `auth_state/`, jadi pada start berikutnya tidak perlu scan ulang.

Mode pengembangan dengan auto-reload:

```bash
npm run dev
```

---

## 6. Daftar Endpoint

| Method | Path | API key | Keterangan |
|---|---|---|---|
| GET | `/health` | tidak | Cek gateway hidup |
| GET | `/` | tidak | Halaman status + QR (HTML) |
| GET | `/status` | ya | Status koneksi (JSON) |
| GET | `/qr` | ya | QR sebagai data URL |
| GET | `/autoreply` | ya | Status balasan otomatis harian |
| POST | `/send` | ya | Kirim pesan |
| POST | `/logout` | ya | Putus tautan perangkat & hapus sesi |

### Mengirim pesan

```bash
curl -X POST http://127.0.0.1:3001/send \
  -H "Authorization: <API_KEY>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "target=6281234567890" \
  -d "message=Halo, ini pesan uji."
```

Respons sukses:

```json
{ "status": true, "id": "3EB0...", "requestid": "3EB0..." }
```

Respons gagal:

```json
{ "status": false, "reason": "WhatsApp belum terhubung. Scan QR terlebih dahulu." }
```

Header `Authorization: <API_KEY>` (tanpa prefix `Bearer`) dipertahankan agar sama
dengan cara Fonnte dan aplikasi laundry memanggil gateway.

### Uji cepat kirim pesan

Isi `TEST_TARGET` di `.env`, lalu:

```bash
npm run test:send
npm run test:send -- "Pesan kustom dari terminal"
```

---

## 7. Menghubungkan ke Aplikasi Laundry

Aplikasi laundry sudah memisahkan integrasi WhatsApp pada `src/lib/fonnte.js` dengan
satu fungsi `sendWhatsAppMessage({ target, message })`. Gateway ini meniru kontrak
Fonnte, jadi **tidak ada kode Next.js yang perlu diubah**. Cukup ubah `.env` di
aplikasi laundry:

```env
FONNTE_API_URL="http://localhost:3001/send"
FONNTE_TOKEN="<API_KEY dari .env gateway>"
FONNTE_DRY_RUN="false"
```

Setelah itu, semua notifikasi (order dibuat, diproses, siap diambil, dll.) akan
dikirim melalui gateway lokal, dan tetap tercatat di tabel `NotificationLog`.

> Nilai `FONNTE_TOKEN` **wajib sama persis** dengan `API_KEY` di gateway.

---

## 8. Mode Simulasi (MOCK_MODE)

Setel `MOCK_MODE="true"` untuk menguji integrasi tanpa menyentuh WhatsApp:

- Gateway tidak membuka koneksi dan tidak perlu scan QR.
- `POST /send` selalu mengembalikan `{ "status": true }` tanpa benar-benar mengirim.
- Halaman status menampilkan mode `Simulasi (MOCK_MODE)`.

Cocok untuk memastikan aplikasi laundry sudah menembak endpoint yang benar sebelum
menautkan nomor asli. Untuk pengiriman nyata, setel kembali `MOCK_MODE="false"`.

---

## 9. Balasan Otomatis (Auto-Reply)

Menggantikan "welcome message" yang sebelumnya ditangani gateway pihak ketiga.
Ini satu-satunya fitur yang **membaca pesan masuk**; sisanya murni pengiriman.

Cara kerja:

1. Ada chat masuk dari sebuah nomor.
2. Jika nomor itu **belum pernah dibalas hari ini**, gateway mengirim template balasan.
3. Pesan berikutnya dari nomor yang sama pada hari yang sama diabaikan.
4. Hitungan direset setiap tengah malam **WIB (Asia/Jakarta)**.

Yang **tidak** memicu balasan: pesan grup, status/broadcast, kanal newsletter, pesan dari
perangkat sendiri, reaksi emoji, edit/hapus pesan, dan pembaruan polling.

Konfigurasi (`.env`):

| Variabel | Keterangan |
|---|---|
| `AUTO_REPLY_ENABLED` | `true` untuk mengaktifkan. |
| `AUTO_REPLY_MESSAGE` | Isi template balasan. |
| `AUTO_REPLY_DELAY_MS` | Jeda sebelum balasan dikirim (ms). Default `3000`. |
| `DATABASE_URL` | MySQL yang sama dengan aplikasi laundry. |

Variabel template yang didukung: `{{name}}` (nama pengirim) dan `{{date}}`.
Placeholder yang tidak dikenal dibiarkan apa adanya dan **tidak** dievaluasi sebagai kode.

### Penyimpanan di database

Riwayat balasan disimpan pada tabel **`auto_reply_logs`** di database aplikasi laundry.

| Kolom | Isi |
|---|---|
| `senderKey` | Identitas pengirim: nomor telepon atau `lid:<id>`. |
| `senderJid` | JID tujuan balasan yang benar-benar dipakai. |
| `pushName` | Nama tampilan pengirim dari WhatsApp. |
| `dayKey` | Tanggal `YYYY-MM-DD` menurut zona waktu Asia/Jakarta. |
| `messageSnapshot` | Isi pesan yang dikirim. |
| `providerMessageId` | ID pesan WhatsApp, diisi setelah berhasil terkirim. |
| `createdAt` | Waktu kejadian (UTC). |

Kuncinya adalah **unique index `(senderKey, dayKey)`**. Gateway tidak sekadar memeriksa
lalu mengirim: ia *mengklaim* lebih dahulu lewat `INSERT`. Bila nomor itu sudah dibalas
hari ini, INSERT ditolak dan pesan tidak dikirim. Jadi aturan "maksimal sekali per nomor
per hari" dijamin oleh **database**, bukan hanya oleh logika aplikasi. Bila pengiriman
gagal, klaim dihapus supaya masih bisa dicoba lagi.

Karena WhatsApp dapat mengenali pengirim lewat alamat LID (`...@lid`) maupun nomor
telepon, gateway mengutamakan nomor telepon bila tersedia agar satu orang tidak
dihitung sebagai dua nomor.

> Tabel ini dibuat oleh **migrasi Prisma** di aplikasi laundry, bukan oleh gateway.
> Ini disengaja: bila gateway membuat tabelnya sendiri, `prisma migrate dev` pada
> aplikasi laundry akan mendeteksi *drift* dan menawarkan reset database.

### Jeda sebelum membalas

Balasan tidak dikirim seketika. Ada jeda sebesar `AUTO_REPLY_DELAY_MS` (bawaan
3000 ms) supaya terasa wajar, bukan seperti bot yang menempel. Jeda ini hanya
menahan pengirim yang bersangkutan — pengirim lain tetap dilayani paralel.
Setel `0` bila ingin balasan langsung.

### "Waiting for this message" di HP

Bila HP yang tertaut menampilkan *"Waiting for this message. This may take a while"*
sementara WhatsApp Web normal, penyebabnya **bukan** jeda. Itu terjadi ketika HP gagal
mendekripsi pesan yang dikirim gateway lalu meminta dikirim ulang, dan Baileys tidak
bisa memenuhinya.

Gateway menyimpan cache pesan terakhir (yang dikirim maupun diterima) dan mengisi opsi
`getMessage` milik Baileys, sehingga permintaan kirim ulang bisa dilayani. Bila pesan
yang diminta sudah keluar dari cache (batas 1000 pesan) atau gateway sempat dimatikan,
permintaan itu tidak terlayani dan placeholder tersebut bisa muncul lagi.

Memeriksa status: `GET /autoreply` (butuh API key), atau lihat langsung halaman
`http://127.0.0.1:3001`. Operasi ini juga tercatat di log terminal:

```
[autoreply] Balasan otomatis terkirim ke 62812xxxxxxx@s.whatsapp.net (kunci: 62812xxxxxxx).
```

Uji logika tanpa menyentuh WhatsApp:

```bash
npm test
```

---

## 10. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `API key tidak valid.` | `API_KEY` gateway ≠ `FONNTE_TOKEN` di aplikasi laundry. |
| `WhatsApp belum terhubung.` | QR belum di-scan. Cek `http://127.0.0.1:3001`. |
| QR muncul lagi tiap start | Folder `auth_state/` terhapus atau tidak punya izin tulis. |
| `Perangkat di-logout` | Perangkat dilepas dari ponsel. Gateway akan menghapus sesi dan membuat QR baru; scan ulang. |
| `Nomor tujuan tidak terdaftar` | Nomor salah format atau benar-benar tidak punya WhatsApp. |
| Instalasi gagal pada `libsignal` | Pastikan **Git** terpasang dan dapat mengakses GitHub. |
| `Tabel "auto_reply_logs" belum ada` | Migrasi belum dijalankan di aplikasi laundry: `npx prisma migrate deploy`. |
| `Balasan otomatis NONAKTIF: DATABASE_URL belum diatur` | Isi `DATABASE_URL` di `.env` gateway dengan kredensial MySQL aplikasi laundry. |

### Log yang wajar muncul (bukan error)

Beberapa baris berikut normal dan **tidak perlu dikhawatirkan**:

| Log | Arti |
|---|---|
| `stream:error` dengan `"code":"515"` lalu `Stream Errored (restart required)` | WhatsApp memang meminta client menyambung ulang tepat **setelah pairing berhasil**. Gateway akan reconnect otomatis dan langsung `Terhubung sebagai ...`. Hanya muncul sekali saat penautan pertama. |
| `"msg":"error in handling message"` | Baileys gagal memproses sebuah **pesan masuk**; umumnya tidak berdampak pada pengiriman. Penting: pengirim `@lid` **tidak boleh** diabaikan lewat `shouldIgnoreJid`, karena itu akan mematikan fitur balasan otomatis. |
| `"msg":"unexpected error in 'init queries'"` (Boom 408 `Timed Out`) | Timeout sementara saat mengambil data awal dari WhatsApp. Sudah ditangani Baileys (`chats.js` membungkusnya dengan `.catch`), hanya dicatat, dan koneksi tetap berjalan. |
| `"msg":"failed to decrypt message"` (`SessionError`) | Baileys tidak punya sesi enkripsi untuk pesan tertentu — umumnya gema pesan dari perangkat sendiri. Hanya dicatat; tidak memengaruhi pengiriman dan tidak memicu balasan otomatis. |
| `"msg":"Connection Terminated"` sesekali | Jaringan/WhatsApp memutus koneksi sementara; reconnect otomatis berjalan. |

> Gateway memasang **jaring pengaman proses** (`src/safetyNet.js`): promise yang
> ditolak tanpa penangkap dan exception tak tertangani akan **dicatat lalu
> diabaikan**, bukan mematikan proses. Ini diperlukan karena Baileys dapat melempar
> error dari jalur async internalnya — misalnya `Connection Closed` ketika koneksi
> putus di tengah proses *retry* pesan masuk, yang dulu membuat gateway mati.
> Konsekuensinya error seperti itu tidak menghentikan layanan; pantau log bila ada
> perilaku janggal.

Untuk terminal yang benar-benar senyap, setel `LOG_LEVEL="silent"`. Untuk menelusuri
masalah, gunakan `LOG_LEVEL="debug"`.

---

## 11. Batasan & Catatan Keamanan

- **Unofficial.** Baileys memakai protokol WhatsApp Web, bukan API resmi. WhatsApp dapat
  membatasi atau memblokir nomor yang terdeteksi sebagai bot. Gunakan **nomor cadangan**
  untuk keperluan demo/skripsi, bukan nomor utama.
- **Sesi adalah kredensial.** Folder `auth_state/` setara kunci akun WhatsApp. Jangan
  di-commit, jangan dibagikan, dan jaga izin aksesnya.
- **Biarkan gateway tetap lokal.** Gateway tidak perlu dibuka ke internet: aplikasi
  laundry memanggilnya lewat `localhost`. Halaman `/` menampilkan QR, dan gateway
  mengikat ke `127.0.0.1` secara default. Bila Anda tetap membukanya ke `0.0.0.0`
  atau lewat tunnel, QR otomatis disembunyikan untuk permintaan yang datang lewat
  proxy, tetapi informasi status tetap terlihat.
- **Bukan untuk serverless.** Gateway butuh proses Node.js yang hidup terus dan disk
  yang persisten untuk `auth_state/`. Jalankan di komputer/server sendiri, bukan di
  platform serverless.
- **Satu nomor per sesi.** Satu instance gateway melayani satu nomor WhatsApp. Menjalankan
  dua instance untuk nomor yang sama akan saling menendang koneksi. Aturan "satu balasan
  per nomor per hari" tetap aman karena dijaga unique index di database.
- **Gateway memakai database aplikasi laundry.** Ia hanya menyentuh tabel
  `auto_reply_logs` dan tidak pernah mengubah tabel lain.

---

## 12. Struktur Proyek

```
whatsapp-gateway/
├── src/
│   ├── server.js          # Express app & routing
│   ├── whatsapp.js        # Koneksi Baileys, QR, kirim pesan, reconnect, pesan masuk
│   ├── autoReply.js       # Logika balasan otomatis (murni, mudah diuji)
│   ├── autoReplyStore.js  # Klaim harian: MySQL untuk runtime, memori untuk uji
│   ├── db.js              # Koneksi MySQL (mysql2)
│   ├── auth.js            # Middleware API key
│   ├── config.js          # Pembacaan environment variable
│   └── statusPage.js      # Halaman status HTML
├── scripts/
│   └── send-message.js    # Uji kirim pesan (kompatibel kontrak Fonnte)
├── test/
│   ├── autoReply.test.js             # Uji unit (tanpa database)
│   └── autoReplyStore.integration.js # Uji integrasi MySQL (dijalankan manual)
├── auth_state/            # Sesi login (dibuat otomatis, JANGAN di-commit)
├── .env.example
└── package.json
```
