# Arsitektur AmbaTicket

Status: Fase 1 sudah dijalankan. Kode yang ada sekarang memakai counter bersyarat, `buyer_quota`, BullMQ, sweeper, rate limit Redis, dan idempotency key. Dokumen ini menjawab dua hal: di mana batas desain sekarang, dan bagaimana bentuknya kalau beban naik lagi.

## 1. Studi kasus dan invariant

Yang dijual: tiket event dengan kuota per tipe, tahan kursi 15 menit, maksimal 4 tiket per pembeli per event, pembayaran disimulasikan, tiket terbit sekali per pesanan.

Ada tujuh invariant yang tidak boleh dilanggar oleh arsitektur apa pun:

| # | Invariant | Kalau dilanggar |
| --- | --- | --- |
| I1 | `terjual + ditahan <= kuota` per tipe tiket | oversell, kursi yang sama dijual dua kali |
| I2 | tiket hidup per `(pembeli, event) <= 4`, termasuk yang belum dibayar | satu orang menyerobot kuota, penjualan tidak adil |
| I3 | satu pesanan menerbitkan tepat satu set tiket | pembayaran ulang mencetak tiket palsu |
| I4 | tiket hanya terbit kalau nominal cocok dan pesanan belum kedaluwarsa | uang masuk setelah kursi dijual ke orang lain |
| I5 | hold yang kedaluwarsa melepas kursi | kuota bocor, kursi kosong tidak terjual |
| I6 | pembayaran yang sama tidak menambah tiket | tiket ganda, kerugian penyelenggara |
| I7 | harga terkunci saat pesan | pembeli ditagih harga yang tidak dia setujui |

Arsitektur dinilai dari seberapa murah ia menjaga tujuh baris ini, bukan dari jumlah komponennya.

## 2. Analisis implementasi Fase 0

Bagian ini merekam kondisi sebelum Fase 1, jadi alasan kenapa fase itu dijalankan. Angka dan batasnya masih berlaku sebagai pembanding.

Yang sudah benar dan sebaiknya dipertahankan di versi mana pun:

- Kuota dihitung dari pesanan yang hidup, tanpa counter. Satu sumber kebenaran, dan I5 benar tanpa job apa pun. Di Fase 1 counter ditambahkan hanya untuk penerimaan, sedangkan laporan tetap turunan.
- Satu kunci per event membuat cek kuota dan cek batas pembeli tidak bisa balapan. Tidak ada deadlock karena hanya satu kunci. Konsekuensinya serialisasi per event, dan itulah yang dihapus di Fase 1.
- Pembayaran idempoten berlapis tiga: kunci baris pesanan, ledger `payment_events`, dan `unique (order_id, seat_no)`.
- Webhook memakai HMAC atas body mentah, timing-safe compare, dan membalas 200 untuk kiriman telat supaya provider tidak mengulang selamanya.
- Uji konkurensi memakai PostgreSQL sungguhan, bukan mock, dan itu satu-satunya cara membuktikan I1.

Batas terukurnya:

- `scripts/loadtest.mjs` menembak 200 pesanan bersamaan untuk kuota 100 di satu container: 100 diterima, 100 ditolak, selesai sekitar 2,5 detik. Artinya plafon realistis sekitar 80 pesanan per detik per event di mesin ini.
- Penyebabnya bukan HTTP, tapi serialisasi: setiap reservasi mengunci baris event yang sama, jadi permintaan antre satu per satu. Di dalam kunci itu ada dua agregat `sum(quantity)`.
- Biaya agregat tumbuh linear terhadap jumlah pesanan hidup. Di 20.000 kursi dan 5.000 pesanan pending, satu cek kuota membaca ribuan baris, dan itu terjadi di dalam kunci.
- Angka 80 per detik cukup untuk tugas kuliah dan event kecil. Untuk on-sale 20.000 tiket yang diserbu 100.000 orang dalam 10 detik pertama, angka itu terlalu jauh.

Titik lemah lain, di luar skala:

| Masalah | Dampak | Catatan |
| --- | --- | --- |
| Tidak ada rate limit | 50 identitas palsu bisa membekukan seluruh kuota 15 menit | sudah diperbaiki di Fase 1 |
| `POST /orders` tanpa idempotency key | klik ganda menghasilkan dua pesanan pending | sudah diperbaiki di Fase 1 |
| Migrasi jalan saat boot | dua replika bisa balapan | aman untuk satu container |
| Sweeper tanpa batas batch | satu `UPDATE` bisa mengunci banyak baris sekaligus | Fase 1 memakai batch 500 dengan `skip locked` |
| Tidak ada auth | header `x-buyer-id` bisa dipalsukan | sesuai aturan tugas, tidak untuk produksi |
| Tanpa observability | tidak tahu berapa permintaan ditolak dan kenapa | tidak bisa menjawab "kenapa saya gagal beli" |

## 3. Asumsi beban target

Supaya rancangan ini punya angka, dipakai satu skenario konkret. Kalau asumsinya berubah, bagian 15 menjelaskan kapan tiap fase dipakai.

| Parameter | Nilai |
| --- | --- |
| Kursi per event | 20.000 |
| Pembeli serentak saat on-sale | 100.000 dalam 10 detik pertama |
| Batas per pembeli | 4 tiket |
| Hold | 15 menit |
| Puncak permintaan di edge | sekitar 10.000 request per detik |
| Pesanan yang lolos ke database | 20.000 dalam 60 detik, sekitar 350 tulis per detik |
| SLO reservasi | p95 di bawah 200 ms setelah lolos antrean |
| SLO baca katalog | p95 di bawah 50 ms |
| Region | satu region (Jakarta), satu primary Postgres |

Perhatikan: 10.000 request per detik di edge bukan berarti 10.000 tulis per detik ke database. Pekerjaan arsitektur justru menahan lebih dari 95% permintaan itu agar tidak pernah sampai ke database. Itu peran Redis dan waiting room, bukan peran database.

## 4. Arsitektur target

```
    browser / mobile
          │
          ▼
  ┌───────────────┐   WAF, bot check, Turnstile, rate limit per IP
  │  CDN + edge   │
  └───────┬───────┘
          │ HTTPS
          ▼
  ┌───────────────┐   auth JWT, validasi, idempotency key,
  │  API (NestJS) │   token antrean, tracing OTel
  │  3+ replika   │
  └──┬──────┬───┬─┘
     │      │   │
     │      │   └──────────────► Redis: cache stok, token bucket,
     │      │                     idempotency key, antrean
     │      │
     │      └──────────────────► Redis: BullMQ (expiry, email, reconcile)
     │
     ▼
  ┌───────────────┐
  │  PostgreSQL   │  primary + replica baca
  │  orders,      │  counter tiket, buyer_quota,
  │  payment_events, outbox
  └──────┬────────┘
         │ outbox
         ▼
  ┌───────────────┐
  │    Worker     │  expire order, settle webhook, kirim tiket,
  │  2+ replika   │  rekonsiliasi counter
  └───────────────┘

  payment provider ──webhook HMAC──► API /webhooks/payments
```

Komponen dan alasannya:

| Komponen | Peran | Bukan perannya |
| --- | --- | --- |
| API NestJS tanpa state | validasi, auth, transaksi tulis, baca | menyimpan stok di memori |
| PostgreSQL | sumber kebenaran semua state dan uang | menahan 10.000 request per detik |
| Redis | penahan beban: cache, rate limit, antrean, token antrean | sumber kebenaran kuota |
| BullMQ | pekerjaan yang boleh terlambat: expiry, email, rekonsiliasi | penentu kebenaran kuota |
| Worker | mengerjakan antrean dan job terjadwal | melayani HTTP pembeli |
| CDN + edge | katalog statis, bot, rate limit kasar | logika tiket |

### Alur reservasi (tulis)

1. Edge menolak bot dan memaksa token antrean kalau on-sale sedang padat.
2. API memeriksa rate limit per pembeli dan per IP di Redis.
3. API memeriksa idempotency key. Kalau sudah pernah dipakai, kembalikan pesanan yang sama.
4. Satu transaksi database:
   - `INSERT INTO buyer_quota ... ON CONFLICT (event_id, buyer_id) DO UPDATE SET live_units = live_units + n WHERE buyer_quota.live_units + n <= 4` (nol baris berarti I2 dilanggar)
   - `UPDATE ticket_types SET held_units = held_units + n WHERE held_units + sold_units + n <= quota` (nol baris berarti I1 dilanggar)
   - `INSERT orders`
   - `INSERT outbox` untuk job kedaluwarsa
5. Setelah commit, outbox relay mendaftarkan job BullMQ dengan `jobId` = id pesanan dan delay 15 menit. Kalau langkah ini gagal, sweeper tetap menyelamatkan.
6. Balasan berisi pesanan dan waktu kedaluwarsa.

Dua statement bersyarat di atas adalah inti pengganti kunci event. Postgres sudah mengunci baris saat `UPDATE`, jadi tidak perlu `SELECT ... FOR UPDATE` lebih dulu, dan tidak ada window antara baca dan tulis. Biayanya mikrodetik per baris, bukan milidetik per transaksi.

### Alur pembayaran

1. Provider memanggil `/webhooks/payments` dengan HMAC, timestamp, dan event id.
2. API mencatat event ke `payment_events` (primary key = event id provider). Bentrok berarti duplikat.
3. API membalas 200 segera, lalu worker menyelesaikan transaksi:
   - kunci baris pesanan
   - tolak kalau `cancelled` atau sudah lewat `expires_at`
   - tolak kalau nominal tidak sama
   - terbitkan tiket dengan `on conflict do nothing`
   - pindahkan unit dari `held_units` ke `sold_units`
   - tulis outbox untuk email tiket
4. Pembayaran yang datang setelah kedaluwarsa tidak menerbitkan tiket. Kursinya sudah boleh dijual ke orang lain.

Untuk demo tugas, jalur sinkron tetap dipertahankan karena lebih mudah dijelaskan. Di produksi, membalas 200 lalu memproses di worker adalah pola yang benar: provider tidak menunggu database kita.

### Alur kedaluwarsa

1. Job BullMQ berjalan pada `expires_at`, dengan `jobId` = id pesanan supaya tidak dobel.
2. Handler melakukan transisi bersyarat:
   `UPDATE orders SET status='expired' WHERE id=$1 AND status='pending' AND expires_at <= now()`
3. Hanya kalau ada baris yang berubah, counter dikurangi. Karena transisinya dijaga, pengurangan tidak mungkin dua kali.
4. Sweeper berjalan tiap 60 detik dengan `FOR UPDATE SKIP LOCKED` dan batch 500, untuk pesanan yang job-nya hilang karena Redis dibersihkan atau worker mati lama.
5. Rekonsiliasi tiap jam menghitung ulang counter dari `orders` dan membandingkannya. Selisih dianggap insiden, bukan hal normal.

Arah kesalahan counter penting: counter boleh meleset ke arah kursi tidak terjual (undersell), tidak boleh ke arah oversell. Selama setiap penambahan dijaga `WHERE` dan setiap pengurangan menempel pada transisi status yang dijaga, arah itu otomatis benar.

## 5. Peran Redis

Empat peran, semuanya boleh hilang tanpa melanggar invariant:

1. **Rate limit dan token antrean.** Token bucket per pembeli, per IP, dan per event. Kalau Redis mati, API turun ke batas kasar per instance dan database tetap dijaga oleh `WHERE` di statement.
2. **Cache stok dan katalog.** Cache-aside dengan TTL 1 detik ditambah invalidasi saat ada perubahan. Angka sisa yang basi 1 detik tidak berbahaya karena keputusan akhir tetap di database.
3. **Idempotency key.** `SET key value NX EX 600` untuk `POST /orders`. Ini yang menghilangkan pesanan ganda karena klik dua kali.
4. **Antrean BullMQ.** Satu instance Redis terpisah dari cache, `maxmemory-policy noeviction`, AOF `everysec`. Kalau Redis antrean memakai `allkeys-lru`, job bisa hilang dan itu kesalahan konfigurasi yang sering terjadi.

Yang sengaja tidak dilakukan: menyimpan kuota sebagai sumber kebenaran di Redis. Kalau Redis menjadi sumber kebenaran, ada dua pilihan buruk saat Redis mati, yaitu berhenti menjual atau oversell. Dengan Redis sebagai penahan beban, kehilangan Redis hanya berarti lebih banyak permintaan sampai ke database.

## 6. Peran BullMQ

| Job | Jadwal | Kalau gagal |
| --- | --- | --- |
| `order.expire` | delayed 15 menit, `jobId` = order id | sweeper 60 detik |
| `payment.settle` | segera setelah webhook dicatat | provider mengulang, inbox idempoten |
| `ticket.deliver` | setelah lunas | outbox belum ditandai terkirim, dicoba lagi |
| `stock.reconcile` | tiap jam | alarm, bukan koreksi otomatis |
| `order.sweep` | tiap 60 detik | alarm kalau tidak jalan 3 menit |

Konfigurasi yang wajib: `attempts` 5 dengan backoff eksponensial, `removeOnComplete` dengan batas umur, `removeOnFail` disimpan untuk investigasi, dan concurrency worker dipisah per jenis job supaya email yang lambat tidak menahan expiry.

## 7. Outbox dan inbox

Dua tabel kecil yang menghilangkan kelas bug paling mahal:

- `outbox(id, topic, payload, created_at, published_at)`. Ditulis di transaksi yang sama dengan perubahan state, lalu relay memindahkannya ke BullMQ. Tanpa ini, ada kemungkinan commit berhasil tapi job gagal didaftarkan, atau sebaliknya.
- `payment_events` sudah berperan sebagai inbox. Primary key dari id provider adalah idempotensi yang tidak bisa dilanggar kode aplikasi.

Job expiry tetap aman walau outbox-nya telat, karena sweeper adalah jaring kedua. Job email tidak punya jaring kedua, jadi di situlah outbox wajib.

## 8. Model data tambahan

| Tabel / kolom | Isi | Alasan |
| --- | --- | --- |
| `ticket_types.sold_units`, `held_units` | agregat yang dijaga `CHECK (sold_units + held_units <= quota)` | menghapus agregat di dalam kunci |
| `buyer_quota(event_id, buyer_id, live_units)` | PK gabungan, `CHECK (live_units between 0 and 4)` | batas pembeli jadi satu baris, bukan agregat |
| `orders.idempotency_key` | unik per pembeli, nullable | klik ganda |
| `outbox` | antrean transaksional | job tidak hilang |
| `stock_buckets` | hanya kalau fase 3 | memecah hotspot satu baris |

`payment_events`, `tickets unique (order_id, seat_no)`, dan snapshot harga tetap seperti sekarang. Ketiganya sudah benar.

## 9. Konkurensi dan urutan kunci

Aturan yang harus dipatuhi semua jalur kode, tulis di satu tempat dan tinjau di review:

1. Kalau pesanan sudah ada, kunci barisnya lebih dulu (`SELECT ... FOR UPDATE`).
2. Lalu `buyer_quota`.
3. Lalu `ticket_types`.

Urutan tetap ini membuat siklus kunci mustahil, jadi tidak ada deadlock. Jalur reservasi memakai urutan yang sama walau tidak mengunci pesanan lama, karena `INSERT orders` tidak pernah menunggu baris lain.

Isolation tetap READ COMMITTED. Dengan `UPDATE` bersyarat, kebenaran tidak bergantung pada snapshot yang lebih ketat, dan tidak ada error serialisasi yang harus di-retry.

Kalau satu tipe tiket melewati sekitar 5.000 tulis per detik, baris counter itu jadi hotspot. Solusinya memecahnya menjadi 16 baris `stock_buckets` dengan hash id pesanan, lalu kapasitas total adalah jumlah semua bucket. Ini ditunda sampai angkanya benar-benar terukur, karena menambah kerumitan sebelum perlu adalah kesalahan yang sama dengan tidak menambah saat perlu.

## 10. Mode kegagalan

| Kejadian | Yang terjadi | Yang menjaga |
| --- | --- | --- |
| Redis cache mati | baca langsung ke replica | cache hanya mempercepat |
| Redis antrean mati | expiry telat maksimal 60 detik | sweeper dan transisi bersyarat |
| Worker mati | antrean menumpuk, tidak ada tiket baru terbit | worker lain, lalu backlog |
| API mati di tengah transaksi | rollback | tidak ada state setengah jadi |
| Postgres failover | transaksi gagal, klien mengulang | idempotency key dan inbox |
| Webhook dikirim 20 kali | satu set tiket | primary key event id dan kunci baris |
| Webhook telat 2 menit | 200, tanpa tiket | cek `expires_at` di dalam kunci |
| Jam server meleset | tidak berpengaruh | semua keputusan waktu memakai `now()` database |
| Counter melenceng | kursi tidak terjual, bukan oversell | `CHECK` dan rekonsiliasi per jam |

## 11. Observability dan SLO

Trace OpenTelemetry dari HTTP sampai query dan job, satu trace id yang ikut ke log dan ke balasan webhook. Metrik yang wajib ada:

- `reserve_total{result}` dengan label `sold_out`, `ticket_limit`, `rate_limited`
- `reserve_latency` p50, p95, p99
- `stock_remaining` per tipe
- `counter_mismatch_total`, alarm kalau lebih dari nol
- `expiry_lag_seconds`, alarm kalau lebih dari 120
- `queue_depth` dan `job_failed_total` per jenis job
- `webhook_duplicate_total` dan `payment_amount_mismatch_total`

SLO: reservasi p95 di bawah 200 ms setelah lolos antrean, baca katalog p95 di bawah 50 ms, tidak ada oversell sepanjang masa hidup sistem, tiket terbit kurang dari 5 detik setelah webhook.

Runbook singkat untuk tiga alarm teratas, karena alarm tanpa tindakan hanya menambah kebisingan.

## 12. Keamanan

- Autentikasi pembeli memakai OIDC, bukan header. `x-buyer-id` hanya boleh ada di mode demo.
- Peran terpisah: pembeli, penyelenggara, admin. Endpoint pembuatan event hanya untuk penyelenggara.
- Webhook: HMAC, timestamp maksimal 5 menit, event id unik, rotasi secret, perbandingan timing-safe.
- Nominal selalu dihitung server dari snapshot harga, tidak pernah dari body.
- Rate limit berlapis: edge per IP, Redis per pembeli, kuota per event. Turnstile di halaman checkout.
- PII seminimal mungkin, enkripsi at rest, retensi tiket 90 hari setelah event, audit log untuk aksi admin.
- Jangan menaruh token pembayaran di log. Masking di logger.

## 13. Deployment

- Satu image, dua entrypoint: `api` dan `worker`. Konfigurasi lewat env, bukan dua codebase.
- Migrasi dipisah jadi job sebelum rollout, memakai `pg_advisory_lock` supaya dua replika tidak balapan. Ini memperbaiki catatan jujur di `DECISIONS.md` bagian 9.
- Migrasi bergaya expand lalu contract: tambah kolom nullable, isi, baru hapus. Rollback harus mungkin tanpa downtime.
- API minimal 3 replika di belakang load balancer, autoscale dari CPU dan RPS. Worker 2 replika dengan concurrency terpisah per job.
- PgBouncer mode transaction. Tidak ada session state di aplikasi.
- Redis terkelola, dua instance: cache dan antrean.
- CDN dan WAF di depan, health check `/` yang sekarang sudah ada dipakai load balancer.
- CI yang sudah ada diperluas: lint, unit, e2e, build, image bertag sha, ditambah job migrasi dan smoke test setelah deploy.

## 14. Strategi uji

Yang sudah ada tetap dipertahankan. Tambahan yang membuktikan arsitektur baru:

| Uji | Membuktikan |
| --- | --- |
| 10.000 pesanan bersamaan untuk 5.000 kursi | I1 di jalur counter, bukan hanya jalur agregat |
| 100 pesanan dari satu pembeli | I2 di jalur `buyer_quota` |
| Matikan worker saat 1.000 hold berjalan | expiry pulih lewat sweeper, tidak ada kuota bocor |
| Kosongkan Redis antrean di tengah uji | sistem tetap benar, hanya lebih lambat |
| Webhook yang sama 100 kali bersamaan | I6 |
| Webhook setelah expiry dan setelah cancel | I4 |
| Uji properti acak: 10.000 operasi campuran, lalu bandingkan counter dengan agregat dari `orders` | tidak ada drift |
| Soak 1 jam dengan 200 pesanan per detik | tidak ada kebocoran koneksi atau memori |

Uji beban dijalankan malam di CI, bukan di setiap pull request, supaya umpan balik PR tetap di bawah 5 menit.

## 15. Rencana migrasi bertahap

Setiap fase harus lulus semua uji fase sebelumnya. Tidak ada fase yang mengubah perilaku HTTP yang terlihat pembeli.

| Fase | Isi | Pemicu | Risiko utama |
| --- | --- | --- | --- |
| 0 (dulu) | kuota turunan, kunci event, sweeper 30 detik | tugas kuliah, event di bawah 1.000 tiket | plafon sekitar 80 pesanan per detik |
| 1 (sekarang) | counter bersyarat, `buyer_quota`, BullMQ expiry, sweeper 60 detik, rate limit Redis, idempotency key | lebih dari 1.000 pesanan per menit, atau p95 di atas 1 detik | transisi status yang lupa mengurangi counter |
| 2 | outbox, worker terpisah, migrasi sebagai job, replica baca, PgBouncer, OTel dan alarm | lebih dari satu replika, butuh email tiket, lebih dari 5.000 tiket per event | dual write dan migrasi yang tidak kompatibel |
| 3 | waiting room, `stock_buckets`, cache katalog di CDN, Kafka kalau ada konsumen lain | lebih dari 5.000 tulis per detik atau on-sale nasional | kompleksitas operasional |

Fase 1 adalah titik di mana Redis dan BullMQ benar-benar masuk. Yang diukur: 200 pesanan bersamaan selesai 1,3 sampai 2,4 detik, dan 500 pesanan untuk kuota 500 diterima semua dalam 3,8 detik, sekitar 130 pesanan per detik, di atas plafon sekitar 80 pesanan per detik pada Fase 0. Tidak ada oversell. Redis tetap bukan sumber kebenaran: kalau mati, rate limit diloloskan dan job gagal dijadwalkan, sedangkan kuota tetap dijaga PostgreSQL.

## 16. Yang sengaja tidak dibangun

- Microservices. Satu API dan satu worker sudah memisahkan beban baca, tulis, dan pekerjaan latar. Memecah jadi servis terpisah menambah masalah konsistensi tanpa pembeli yang peduli.
- Kafka. BullMQ cukup untuk pekerjaan yang diukur dalam menit. Kafka baru masuk kalau ada tiga konsumen berbeda yang butuh event yang sama.
- Kursi bernomor. Mengubah model menjadi pemilihan kursi per baris, dan itu masalah produk berbeda.
- Multi-region aktif-aktif. Penjualan tiket butuh satu titik keputusan. Replica baca lintas region cukup.
- Machine learning untuk antrean. Token bucket dan Turnstile menyelesaikan 95% kasus dengan biaya yang bisa dijelaskan.

## 17. Pertanyaan yang harus dijawab penyelenggara

Rancangan ini masih menggantung pada lima keputusan bisnis. Jangan dikunci di kode sebelum ada jawabannya:

1. Kalau webhook telat, uang dikembalikan otomatis atau manual?
2. Apakah satu pembeli boleh membeli di beberapa tipe tiket dalam satu pesanan? Kalau ya, perlu `order_items`.
3. Apakah tiket bisa dipindahtangankan? Kalau ya, butuh tabel pemilik tiket dan aturan transfer.
4. Berapa lama data tiket disimpan setelah event?
5. Apakah penyelenggara boleh menaikkan kuota saat penjualan berjalan? Kalau ya, `quota` harus bisa naik dengan aman di bawah kunci.

## 18. Jawaban singkat untuk sidang

- Kenapa sekarang pakai Redis? Karena kunci satu baris event membuat semua pesanan pada satu event antre, dan plafonnya sekitar 80 pesanan per detik. Redis dipakai untuk rate limit dan antrean, bukan untuk menyimpan kuota.
- Kalau pakai Redis, apa sumber kebenaran kuota? Tetap PostgreSQL. Redis hanya menahan permintaan supaya database tidak kebanjiran. Kalau Redis mati, sistem melambat, bukan salah.
- Kenapa BullMQ, bukan cron? Cron tidak punya penjadwalan per pesanan dan tidak punya retry. Tapi kebenaran expiry tetap tidak bergantung pada antrean, karena ada sweeper dan transisi bersyarat.
- Bagaimana mencegah oversell dengan counter? Setiap penambahan dijaga `WHERE held + sold + n <= quota` dalam satu statement, ditambah `CHECK` di database. Semua pengurangan memakai `greatest(..., 0)`, jadi counter hanya bisa terlalu besar, tidak pernah terlalu kecil. Kalau counter gagal dipakai, pesanan kedaluwarsa dilepas lebih dulu lalu `UPDATE` dicoba sekali lagi.
- Apa yang paling dulu diperbaiki dari kode sekarang? Rekonsiliasi counter terjadwal dan pembatasan per IP di edge. Sekarang drift hanya diperbaiki saat ada permintaan, dan rate limit masih jendela tetap di aplikasi.
