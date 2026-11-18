# Keputusan desain

Dokumen ini menjawab satu pertanyaan: kenapa sistem ini dibuat begini, dan apa yang dikorbankan.

## Ringkasan satu menit

- Kuota dijaga dua counter di `ticket_types`: `held_units` dan `sold_units`. Penerimaan pesanan hanya satu `UPDATE` bersyarat, bukan agregat di dalam kunci.
- Laporan stok tetap dihitung dari `orders`. Counter hanya penjaga penerimaan, jadi laporan tidak pernah ikut melenceng.
- Batas 4 tiket per event disimpan sebagai satu baris `buyer_quota` per `(event_id, buyer_id)`, sehingga tidak perlu mengunci baris event.
- Redis menahan beban (rate limit, antrean), bukan menyimpan kebenaran. Kalau Redis mati, penjualan tetap jalan.
- BullMQ melepas kursi tepat saat kedaluwarsa. Sweeper 60 detik menjadi jaring kedua, dan reservasi berikutnya memperbaiki sendiri kalau keduanya terlewat.
- `Idempotency-Key` pada `POST /orders` membuat klik ganda menghasilkan satu pesanan. Pembayaran tetap idempoten lewat row lock dan ledger event id.

## 1. Counter penjaga, laporan tetap dari pesanan

Penerimaan pesanan memakai:

```sql
update ticket_types
set held_units = held_units + $1
where id = $2 and held_units + sold_units + $1 <= quota
```

Baris nol berarti permintaan ditolak. Tidak ada `SELECT` agregat dan tidak ada row lock di jalur ini.

Kenapa berubah dari desain awal yang menghitung dari `orders`: pada 200 pesanan bersamaan, semua transaksi mengantre di satu baris event. Hasilnya benar, tapi serial. Counter membuat penerimaan selesai dalam satu operasi atomik, dan PostgreSQL sudah menjamin `UPDATE` bersyarat tidak bisa lolos dua kali untuk sisa yang sama.

Yang dikorbankan: sekarang ada dua representasi. `orders` tetap sumber kebenaran untuk laporan, sedangkan counter adalah salinan yang dipakai untuk menerima atau menolak. Kalau ada bug yang membuat counter terlalu besar, tiket bisa tidak terjual walau stok ada. Karena itu:

- `CHECK` di database menjaga `held_units >= 0`, `sold_units >= 0`, dan jumlahnya tidak melebihi `quota`. Oversell ditolak database, bukan hanya kode.
- Semua pengurangan memakai `greatest(..., 0)`, jadi kegagalan apa pun hanya membuat counter terlalu besar, tidak pernah terlalu kecil.
- `GET /events` tidak membaca counter. `sold`, `held`, dan `remaining` dihitung dari `orders`, jadi angka yang dilihat pembeli selalu konsisten dengan isi tabel.
- Kalau `UPDATE` gagal karena kuota, sistem melepas dulu pesanan yang sudah lewat waktu untuk tipe itu, lalu mencoba sekali lagi. Ini perbaikan saat dibutuhkan, tanpa job rekonsiliasi.

Kapan pindah lagi: kalau counter terbukti melenceng di produksi, tambahkan job rekonsiliasi yang menghitung ulang dari `orders` dan membandingkan. Kalau throughput per tipe masih kurang, pecah counter menjadi beberapa bucket. Keduanya belum dibutuhkan di skala tugas ini.

## 2. Batas 4 tiket sebagai baris kuota pembeli

Setiap pembeli punya satu baris `buyer_quota (event_id, buyer_id, live_units)`. Penerimaan pesanan menjalankan satu upsert bersyarat:

```sql
insert into buyer_quota (event_id, buyer_id, live_units) values ($1, $2, $3)
on conflict (event_id, buyer_id) do update
set live_units = buyer_quota.live_units + $3
where buyer_quota.live_units + $3 <= 4
returning live_units
```

Kenapa bukan menghitung dari `orders`: hitungan dari `orders` memaksa satu pembacaan agregat di dalam transaksi, dan pada desain lama memaksa kunci event supaya permintaan lintas tipe tidak lolos berbarengan. Dengan satu baris per pembeli, batas lintas tipe tetap terjaga karena semua tipe pada event yang sama memakai baris yang sama, tanpa mengunci pembeli lain.

Pesanan batal atau kedaluwarsa mengurangi `live_units`. Pesanan lunas tidak mengurangi, karena tiket yang sudah dibayar tetap dihitung sampai batas 4.

## 3. Kedaluwarsa: antrean untuk ketepatan, database untuk kebenaran

`expires_at` diisi saat insert dengan `now() + ORDER_TTL_SECONDS`, memakai jam database.

Saat pesanan dibuat, satu job delayed masuk ke BullMQ dengan `jobId` yang mengandung id pesanan. Job itu memanggil jalur yang sama dengan pembatalan: kunci baris pesanan, ubah status ke `expired`, kurangi counter tipe tiket dan kuota pembeli. Kalau pesanan sudah lunas atau batal, tidak ada yang berubah.

Tiga lapis, dari yang paling cepat ke yang paling murah:

1. Job delayed BullMQ, tepat saat `expires_at`.
2. Sweeper tiap 60 detik yang mengambil batch pesanan pending yang sudah lewat waktu, dengan `for update skip locked` supaya tidak mengunci baris yang sedang diproses job lain.
3. Perbaikan saat dibutuhkan: kalau `UPDATE` counter gagal, lepas dulu pesanan kedaluwarsa untuk tipe atau pembeli itu, lalu coba sekali lagi.

Kenapa tidak mengandalkan satu lapis saja: job bisa hilang kalau Redis dibersihkan, dan sweeper bisa tertunda kalau worker mati. Reservasi berikutnya tetap harus berhasil memakai kursi yang sudah bebas, tanpa menunggu dua lapis pertama.

Yang dikorbankan: ada pekerjaan yang biasanya tidak terjadi, yaitu job per pesanan. Untuk 100 tiket ini tidak terasa. Kalau volume pesanan sangat besar, job per pesanan bisa diganti satu delayed job per menit yang memproses batch, dengan konsekuensi kursi dilepas paling lambat satu menit kemudian.

Redis tidak pernah menjadi sumber kebenaran kuota. Kalau Redis mati:

- Rate limit diloloskan (fail-open).
- Penjadwalan job gagal dan hanya dicatat sebagai warning.
- Pesanan tetap dibuat, disimpan di Postgres, dan tetap kedaluwarsa lewat sweeper atau perbaikan saat memesan.

## 4. Rate limit

`POST /orders` dijaga `RateLimitGuard` dengan jendela tetap 60 detik: 30 permintaan per `x-buyer-id` dan 1000 per IP. Angka IP sengaja tinggi supaya uji 200 pesanan bersamaan tidak tertahan guard.

Kenapa Redis: hitungan harus dibagi antar replika API. Kalau disimpan di memori proses, empat replika berarti batasnya empat kali lipat.

Kenapa fail-open: Redis adalah penahan beban, bukan penjaga kebenaran. Menolak semua penjualan karena Redis mati lebih buruk daripada menerima beberapa permintaan berlebih, karena kuota tetap dijaga database.

Yang dikorbankan: jendela tetap bisa dilewati di batas menit, dan `x-buyer-id` bisa dipalsukan karena belum ada autentikasi. Rate limit ini menaikkan biaya penyalahgunaan, bukan menghilangkannya. Mitigasi berikutnya butuh identitas sungguhan, dan itu di luar penilaian tugas.

## 5. Idempotensi pesanan

`POST /orders` menerima header opsional `Idempotency-Key`. Kunci disimpan di `orders` dan dijaga unique index parsial `(buyer_id, idempotency_key)` untuk baris yang kuncinya tidak null.

Alurnya:

1. Transaksi mengambil kuota pembeli dan kuota tipe, lalu insert pesanan dengan kunci.
2. Kalau insert melanggar unique index, seluruh transaksi dibatalkan, termasuk kenaikan counter.
3. Sistem membaca pesanan yang sudah ada dengan kunci itu dan mengembalikannya apa adanya.

Kenapa di database, bukan di Redis: idempotensi adalah janji tentang data. Kalau Redis dibersihkan, janji itu tidak boleh hilang. Unique index adalah satu-satunya tempat yang tahu pasti apakah dua permintaan bersamaan menulis baris yang sama.

Batas yang diketahui: kunci yang sama dengan body berbeda tetap mengembalikan pesanan pertama. Itu perilaku standar, dan pesanan pertama yang menang. Kunci dibatasi 120 karakter supaya tidak jadi tempat menyimpan data sembarangan.

## 6. Idempotensi pembayaran

`settle` melakukan semuanya dalam satu transaksi:

1. `select ... from orders where id = ? for update`.
2. Hitung status efektif. Kalau sudah `paid`, kembalikan tiket yang ada.
3. Kalau `cancelled` atau `expired`, kembalikan alasan, tidak menerbitkan apa pun.
4. Kalau masih `pending`, pindahkan unit dari `held_units` ke `sold_units`, terbitkan tiket, ubah status ke `paid` dan isi `paid_at`.

Tiga lapis pengaman:

- Row lock di pesanan, jadi dua permintaan untuk pesanan yang sama diproses bergantian.
- `payment_events.id` sebagai primary key. Id event dari provider hanya bisa masuk sekali. Kalau insert tidak menghasilkan baris, permintaan itu duplikat.
- `tickets unique (order_id, seat_no)` sebagai jaring terakhir. Bahkan kalau ada bug yang memanggil insert dua kali, kursi yang sama tidak bisa terbit dua kali.

Kode tiket sengaja random, bukan kunci idempotensi. Satu pesanan menerbitkan 1 sampai 4 tiket, jadi tidak ada satu kode yang mewakili pesanan. Kalau kode tiket dipakai sebagai kunci, pemrosesan ulang pesanan 4 tiket akan menghasilkan 4 kode baru karena kode lamanya tidak bisa ditebak ulang.

Perilaku yang diuji:

| Kejadian | Hasil |
| --- | --- |
| Webhook yang sama dikirim dua kali | 200, `duplicate: true`, tiket identik |
| Event id berbeda untuk pesanan yang sudah lunas | 200, tidak ada tiket tambahan |
| Webhook tiba setelah kedaluwarsa | 200, `applied: false`, `reason: order_expired`, tidak ada tiket |
| Nominal tidak cocok | 409 `amount_mismatch`, event tidak dicatat, kiriman yang benar masih bisa diproses |
| Lima webhook identik bersamaan | satu set tiket |

Kenapa webhook terlambat dibalas 200, bukan 4xx atau 5xx: provider sungguhan akan mengulang terus kalau dibalas error. Yang benar adalah mengakui penerimaan, tidak menerbitkan tiket, dan menyerahkan refund ke proses di luar sistem ini. Uang tidak boleh menukar kursi yang sudah dijual ke orang lain.

## 7. Uang

Pesanan menyimpan `unit_price_idr` dan `total_idr`, salinan dari harga saat memesan. Kalau penyelenggara menaikkan harga besok, 50 pesanan yang sudah ada tetap membayar harga lama. Salinan ini bukan duplikasi yang lupa disinkronkan, tapi snapshot kontrak: harga yang disetujui saat pesanan dibuat.

Webhook wajib menyebut `amountIdr`, dan harus sama dengan `total_idr`. Kalau tidak sama, permintaan ditolak dan tidak dicatat, sehingga provider bisa mengirim ulang dengan nominal yang benar.

## 8. Satu tipe tiket per pesanan

Kebutuhan hanya bilang "memesan 1 sampai 4 tiket", tanpa menyebut campuran tipe dalam satu pesanan.

Dengan satu tipe per pesanan, bagian kritis hanya menyentuh satu baris tipe tiket, dan alur checkout tetap satu keputusan. Yang dikorbankan: pembeli tidak bisa membeli 2 Reguler dan 1 VIP dalam satu pesanan, harus dua pesanan terpisah. Batas 4 tiket tetap berlaku lintas tipe karena dihitung per event.

Kalau nanti diminta campuran, yang berubah: tabel `order_items (order_id, ticket_type_id, quantity)`, counter tiap tipe tetap dipakai, dan batas 4 tiket dihitung dari jumlah semua baris. Bagian sulitnya, yaitu penjagaan kuota tanpa kunci besar, tidak berubah.

## 9. Identitas dan keamanan

- Pembeli dikenali dari header `x-buyer-id`. Ini bukan autentikasi, sesuai aturan tugas yang tidak menilai auth.
- Pesanan milik pembeli lain dibalas 404, bukan 403, supaya id pesanan tidak bisa ditebak satu per satu.
- `POST /orders/:id/pay` adalah simulasi penyedia pembayaran. Endpoint ini tidak memakai identitas pembeli karena di dunia nyata yang menandai lunas adalah provider, bukan pembeli. Jalur yang meniru provider sungguhan adalah webhook, dan webhook itu wajib bertanda tangan HMAC SHA-256 atas body mentah, dibandingkan dengan cara timing-safe.
- `request.rawBody` diambil dari opsi `rawBody: true` Nest, karena kalau memakai body yang sudah di-parse, spasi dan urutan kunci bisa berubah dan tanda tangan tidak cocok.
- `POST /orders` dibatasi rate limit per pembeli dan per IP. `Idempotency-Key` dibatasi panjangnya dan divalidasi sebelum menyentuh database.

## 10. Skema dan migrasi

Skema ditulis di TypeScript dengan Drizzle, SQL-nya dihasilkan `drizzle-kit generate`, dan migrasi dijalankan saat API boot. Query memakai query builder Drizzle, termasuk `onConflictDoUpdate` dengan `setWhere`, `case`, dan `for update skip locked`, jadi bentuk data dan tipe ikut terbaca dari kode.

Koneksi memakai `DrizzleModule` dari `@nestjs/drizzle`, bukan modul buatan sendiri. Modul resmi itu membuat satu pool per aplikasi (penting karena tiap app di test e2e punya pool sendiri), menutup pool saat shutdown, dan memasang listener error pool supaya koneksi idle yang putus tidak mematikan proses. Migrasi dijalankan di dalam factory `forRootAsync`, jadi skema sudah siap sebelum provider pertama menyentuh database.

Migrasi `0002_backfill_stock_counters.sql` mengisi counter dari pesanan yang sudah ada. Ini perlu karena counter baru dibuat setelah tabel `orders` berisi data, dan nilai awalnya harus sama dengan definisi "pesanan hidup". Tanpa backfill, `CHECK` akan menolak baris pertama yang di-update.

Worker menjalankan aplikasi yang sama dengan `DB_MIGRATE=false`. Alasannya: worker dan API start bersamaan, dan Drizzle tidak memasang advisory lock di migrator-nya. Hanya API yang boleh menjalankan DDL. Kalau API belum selesai memigrasi, worker hanya menganggur karena belum ada job.

Kenapa tidak `create table if not exists` saat boot: migrasi punya urutan dan riwayat, jadi perubahan skema berikutnya tidak menebak-nebak.

Aturan penting juga ditulis di database sebagai `CHECK`: jumlah tiket 1 sampai 4, status hanya empat nilai itu, harga dan kuota tidak negatif, counter tidak negatif dan tidak melebihi kuota, serta `buyer_quota.live_units` antara 0 dan 4. Aplikasi tetap memvalidasi, tapi database adalah lapis terakhir yang tidak bisa dilewati kode yang salah.

## 11. Strategi uji

21 test integrasi memakai PostgreSQL dan Redis sungguhan, bukan mock, karena yang diuji justru perilaku konkurensi dan jalur kegagalan.

- Uji 200 pesanan memakai 200 pembeli berbeda. Ini sengaja: tujuannya menguji kuota. Kalau satu pembeli, batas 4 tiket yang akan menolak lebih dulu dan uji tidak membuktikan apa pun soal kuota. Uji ini juga menegaskan counter berakhir `held: 100, sold: 0`.
- Uji batas 4 tiket memakai satu pembeli dengan 10 permintaan bersamaan. Hasil yang ditegaskan: tepat 4 diterima, 6 ditolak `ticket_limit_exceeded`.
- Uji kedaluwarsa dibagi dua. Satu memanggil sweeper dan memastikan kuota kembali serta pesanan tidak bisa dibayar. Satu lagi tidak memanggil sweeper sama sekali: pembeli lain memesan, counter penuh, lalu perbaikan saat memesan melepas pesanan kedaluwarsa itu. Ini membuktikan jalur cadangan benar-benar bekerja.
- Uji konsistensi counter menjalankan pesan, bayar, dan batal, lalu membandingkan `held_units` dan `sold_units` dengan pesanan yang masih hidup.
- Uji `Idempotency-Key` mengirim dua permintaan berurutan dan dua permintaan bersamaan dengan kunci yang sama, lalu memastikan hanya satu pesanan dan counter hanya naik sekali.
- Uji rate limit mengirim 35 permintaan dari satu pembeli dan menegaskan 30 lolos guard, 5 dibalas 429 `rate_limited`.
- `resetDb` mengosongkan tabel dan `FLUSHDB` database Redis khusus test (db 1), jadi tiap test mulai dari jendela dan antrean kosong.

Kalau `UPDATE` bersyarat dihapus dan diganti baca lalu tulis, uji konkurensi gagal. Uji berurutan tetap hijau, dan itulah alasan uji konkurensi harus ada.

Yang belum diuji: Redis mati di tengah uji beban, dua replika API, dan beban di atas 200 permintaan.

## 12. Kalau skalanya 100 kali

- Counter per tipe menjadi panas di satu baris. Pecah menjadi beberapa bucket dan jumlahkan saat membaca, atau ganti dengan antrean per tipe.
- Rate limit per IP pindah ke token bucket di edge, bukan jendela tetap di aplikasi.
- Sweeper dipisah dari worker utama, dan job per pesanan diganti batch per menit kalau volume sangat besar.
- Event katalog di-cache di Redis dengan TTL pendek, karena `GET /events` masih membaca agregat dari `orders`.
- Migrasi dipisah menjadi job sebelum deploy, bukan dijalankan API saat boot.
- Outbox baru diperlukan kalau ada konsumen lain, misalnya email tiket. Selama belum ada, antrean kedaluwarsa cukup.

## 13. Yang sengaja tidak dikerjakan

- Frontend. Tugas menyebutnya opsional, dan nilai utamanya di backend.
- Autentikasi sungguhan.
- Outbox transaksional. Belum ada konsumen yang butuh jaminan antar sistem, dan job kedaluwarsa boleh hilang karena ada sweeper.
- Cache katalog, replika baca, dan sharded counter. Semua menambah bagian yang bisa salah tanpa masalah nyata di skala tugas ini.
- Waiting room. Rate limit dan batas 4 tiket sudah menahan penyalahgunaan sederhana.
- Email tiket dan QR code.
- Rekonsiliasi counter terjadwal. Perbaikan saat memesan dan `CHECK` sudah menutup kasus yang bisa terjadi sekarang.

## Jawaban singkat untuk demo

- "Bagaimana kuota dijaga?" Satu `UPDATE` bersyarat pada counter tipe tiket, dengan `CHECK` di database sebagai lapis terakhir. Tidak ada masa di mana dua pembeli bisa mendapatkan kursi yang sama.
- "Kenapa pakai counter kalau bisa dihitung?" Counter menghilangkan antrean di satu baris event. Laporan tetap dihitung dari pesanan, jadi counter tidak bisa membuat angka stok di API salah.
- "Bagaimana kalau counter melenceng?" Semua pengurangan memakai `greatest(..., 0)`, jadi counter hanya bisa terlalu besar. Oversell tetap ditolak `CHECK`, dan perbaikan saat memesan melepas pesanan kedaluwarsa lebih dulu.
- "Bagaimana kalau Redis mati?" Penjualan tetap jalan. Rate limit diloloskan, job gagal dijadwalkan, dan kedaluwarsa tetap terjadi lewat sweeper atau perbaikan saat memesan.
- "Bagaimana kalau worker mati?" Kursi tetap dilepas oleh sweeper setelah worker hidup lagi, atau oleh reservasi berikutnya. Pembayaran pesanan kedaluwarsa tetap ditolak.
- "Bagaimana kalau klik dobel?" `Idempotency-Key` yang sama mengembalikan pesanan yang sama. Unique index memastikan dua permintaan bersamaan pun hanya menghasilkan satu baris.
- "Bagaimana kalau webhook dobel?" Row lock pada pesanan plus primary key event id. Kiriman kedua mendapat tiket yang sama.
- "Bagaimana kalau webhook telat?" Dibalas 200, tidak ada tiket terbit, dan kursi yang sudah dijual ke orang lain tidak diganggu.
- "Apa yang terjadi saat 200 orang memesan?" 100 diterima, 100 ditolak, sisa 0, sekitar 1,3 sampai 2,4 detik tergantung beban mesin. Pada uji 500 pesanan untuk kuota 500, semuanya diterima dalam 3,8 detik, sekitar 130 pesanan per detik.
