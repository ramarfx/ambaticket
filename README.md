# AmbaTicket

Backend penjualan tiket event dengan kuota terbatas. Dua tipe tiket per event, tiap tipe punya kuota dan harga sendiri. Pesanan menahan kuota selama 15 menit, maksimal 4 tiket per pembeli per event, pembayaran disimulasikan, dan tiket terbit tepat sekali per pesanan.

Stack: NestJS 12, PostgreSQL 17, Redis 7, BullMQ, Drizzle ORM, Docker Compose. Test dengan Vitest.

## Jalankan dari mesin bersih

Syarat: Docker dan Docker Compose.

```bash
git clone <repo> && cd ambaticket
docker compose up --build
```

API hidup di `http://localhost:3000`. Perintah itu menyalakan database dan Redis (dengan healthcheck), menjalankan migrasi, lalu API dan worker pelepasan kuota. Cek dengan:

```bash
curl localhost:3000
# {"service":"ambaticket","status":"ok"}
```

Catatan: kalau sebelumnya pernah ada volume lama, jalankan `docker compose down -v` sekali supaya database awal, database test, dan data Redis dibuat ulang.

## Alur demo (copy paste)

Butuh `curl` dan `jq`.

```bash
# 1. Penyelenggara membuat event: Reguler 100 tiket, VIP 10 tiket
EVENT=$(curl -s -X POST localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{"name":"Konser Amba","venue":"Jakarta","startsAt":"2026-12-01T19:00:00+07:00",
       "ticketTypes":[{"name":"Reguler","priceIdr":150000,"quota":100},
                      {"name":"VIP","priceIdr":500000,"quota":10}]}')
echo "$EVENT" | jq '.ticketTypes[] | {name, quota, remaining}'

EVENT_ID=$(echo "$EVENT" | jq -r .id)
REGULER=$(echo "$EVENT" | jq -r '.ticketTypes[] | select(.name=="Reguler") | .id')

# 2. Pembeli memesan 2 tiket. Kuota langsung ditahan.
ORDER=$(curl -s -X POST localhost:3000/orders \
  -H 'content-type: application/json' -H 'x-buyer-id: buyer-1' \
  -d "{\"ticketTypeId\":\"$REGULER\",\"quantity\":2}")
echo "$ORDER" | jq '{id, status, totalIdr, expiresAt}'
ORDER_ID=$(echo "$ORDER" | jq -r .id)

# 3. Sisa kuota turun walau belum dibayar
curl -s localhost:3000/events/$EVENT_ID | jq '.ticketTypes[] | {name, sold, held, remaining}'

# 4. Tandai lunas, tiket terbit
curl -s -X POST localhost:3000/orders/$ORDER_ID/pay | jq '{status: .order.status, tickets: [.tickets[].code]}'

# 5. Riwayat dan tiket pembeli
curl -s localhost:3000/orders -H 'x-buyer-id: buyer-1' | jq '.[].status'
curl -s localhost:3000/tickets -H 'x-buyer-id: buyer-1' | jq '.[] | {code, eventName, ticketTypeName}'
```

Pembatalan sebelum bayar mengembalikan kuota seketika:

```bash
curl -s -X POST localhost:3000/orders/$ORDER_ID/cancel -H 'x-buyer-id: buyer-1'
```

Pesanan yang tidak dibayar dalam 15 menit berhenti menahan kuota dengan sendirinya. Worker melepas kuota lewat antrean BullMQ tepat saat kedaluwarsa, dan sweeper 60 detik menjadi jaring kedua. Untuk demo tanpa menunggu, jalankan API dan worker dengan `ORDER_TTL_SECONDS=10`.

## Cara menandai pesanan lunas

Ada dua cara, keduanya memakai jalur transisi yang sama.

1. Simulasi penyedia pembayaran, satu panggilan:

```bash
curl -s -X POST localhost:3000/orders/$ORDER_ID/pay
```

2. Webhook ala penyedia sungguhan, dengan tanda tangan HMAC SHA-256 dari body mentah:

```bash
SECRET=dev-webhook-secret
BODY="{\"eventId\":\"evt-demo-1\",\"orderId\":\"$ORDER_ID\",\"type\":\"payment.succeeded\",\"amountIdr\":300000}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')

curl -s -X POST localhost:3000/webhooks/payments \
  -H 'content-type: application/json' \
  -H "x-payment-signature: $SIG" \
  -d "$BODY" | jq
```

Kirim ulang perintah yang sama: hasilnya `{"applied":true,"duplicate":true,...}` dengan tiket yang identik, bukan tiket baru. Kirim setelah pesanan kedaluwarsa: `{"applied":false,"reason":"order_expired"}` dan tidak ada tiket yang terbit. Tanda tangan salah dibalas 401.

Rahasia HMAC diatur lewat `PAYMENT_WEBHOOK_SECRET` (default `dev-webhook-secret`).

## Uji otomatis

Semua test di dalam container, tidak perlu memasang apa pun selain Docker:

```bash
docker compose --profile test run --build --rm test
```

Atau di mesin yang punya Bun:

```bash
bun install
docker compose up -d db redis
bun run test        # unit, tidak butuh database
bun run test:e2e    # 21 test integrasi, butuh database dan Redis
```

Yang diuji: alur pesan sampai tiket, kuota habis, batal mengembalikan kuota, batas 4 tiket (termasuk lintas tipe dan pesanan lunas), pesanan kedaluwarsa lewat sweeper dan lewat perbaikan saat memesan, counter penjaga yang selalu sama dengan pesanan hidup, idempotensi `Idempotency-Key` (berurutan dan bersamaan), rate limit 429, bayar dua kali, webhook ganda, webhook terlambat, nominal tidak cocok, 200 pesanan bersamaan, dan 10 pesanan bersamaan dari satu pembeli.

## Bukti 200 pesanan bersamaan

`scripts/loadtest.mjs` menembak API yang sedang hidup: 200 pesanan untuk kuota 100.

```bash
node scripts/loadtest.mjs
```

Hasil nyata dari mesin ini (Docker, PostgreSQL 17):

```
permintaan      : 200 bersamaan, kuota 100
diterima (201)  : 100
ditolak (409)   : 100
sisa kuota      : 0, terjual 0, ditahan 100
waktu total     : 1350 ms
HASIL: tepat 100 terjual, tidak ada oversell
```

Dengan beban lebih besar, kuota 500 untuk 500 pembeli:

```bash
BUYERS=500 QUOTA=500 node scripts/loadtest.mjs
```

```
permintaan      : 500 bersamaan, kuota 500
diterima (201)  : 500
ditolak (409)   : 0
sisa kuota      : 0, terjual 0, ditahan 500
waktu total     : 3843 ms
HASIL: tepat 500 terjual, tidak ada oversell
```

Sekitar 130 pesanan diterima per detik, di atas plafon sekitar 80 pesanan per detik pada desain Fase 0. Waktu total uji 200 bervariasi 1,3 sampai 2,4 detik tergantung beban mesin, karena yang tersisa di jalur kritis sudah bukan antrean kuota. Batas rate limit per IP (default 1000 per menit) ikut menentukan, jadi jalankan sekali per menit.

Test yang sama juga jalan di CI: `test/concurrency.e2e-spec.ts` menegaskan tepat 100 diterima, 100 ditolak `sold_out`, jumlah tiket tersimpan 100, dan counter penjaga berakhir `held: 100, sold: 0`.

## CI/CD

`.github/workflows/ci.yml`:

1. Setiap push dan pull request: install, lint, unit test, e2e test dengan service PostgreSQL, lalu build.
2. Hanya kalau test hijau dan event-nya push: build image `runtime` dan push ke GHCR.
3. Tag image selalu dari commit, bukan `latest`:

```
ghcr.io/<owner>/ambaticket:sha-<commit-sha-penuh>
```

Ambil image itu di mesin lain dengan `docker pull`, lalu jalankan dengan `DATABASE_URL` yang menunjuk database Postgres.

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/` | status API |
| `POST` | `/events` | buat event dan tipe tiketnya |
| `GET` | `/events` | daftar event dengan sisa kuota tiap tipe |
| `GET` | `/events/:id` | detail event dan stok |
| `POST` | `/orders` | pesan 1 sampai 4 tiket (`x-buyer-id`, opsional `Idempotency-Key`) |
| `GET` | `/orders` | riwayat pesanan pembeli |
| `GET` | `/orders/:id` | satu pesanan beserta tiketnya |
| `POST` | `/orders/:id/cancel` | batal sebelum bayar |
| `GET` | `/tickets` | semua tiket milik pembeli |
| `POST` | `/orders/:id/pay` | simulasi pembayaran lunas |
| `POST` | `/webhooks/payments` | webhook provider, wajib HMAC |

Identitas pembeli memakai header `x-buyer-id` (bebas diisi apa saja). Ini bukan autentikasi sungguhan, sesuai aturan tugas.

`POST /orders` menerima header opsional `Idempotency-Key`. Kirim ulang dengan kunci yang sama, termasuk saat dua permintaan datang bersamaan, dan pembeli menerima pesanan yang sama tanpa tambahan kuota.

### Bentuk data penting

`GET /events/:id` mengembalikan stok yang bisa dipercaya:

```json
{
  "id": "...",
  "name": "Konser Amba",
  "ticketTypes": [
    { "name": "VIP", "priceIdr": 500000, "quota": 10, "sold": 0, "held": 0, "remaining": 10 },
    { "name": "Reguler", "priceIdr": 150000, "quota": 100, "sold": 0, "held": 2, "remaining": 98 }
  ]
}
```

`sold` tiket lunas, `held` tiket di pesanan yang belum lewat 15 menit, `remaining` sisanya.

Pesanan berstatus `pending`, `paid`, `cancelled`, atau `expired`.

### Kode kesalahan

| HTTP | `code` | Arti |
| --- | --- | --- |
| 400 | bawaan Nest | body tidak valid, misalnya jumlah 0 atau 5 |
| 401 | `invalid_signature` | tanda tangan webhook salah |
| 404 | `event_not_found`, `ticket_type_not_found`, `order_not_found` | data tidak ada atau bukan milik pembeli |
| 409 | `sold_out` | sisa kuota kurang dari permintaan |
| 409 | `ticket_limit_exceeded` | total tiket pembeli di event itu akan lewat 4 |
| 409 | `order_expired`, `order_cancelled`, `order_already_paid` | pesanan tidak bisa dibayar atau dibatalkan |
| 409 | `amount_mismatch` | nominal webhook tidak sama dengan total pesanan |
| 429 | `rate_limited` | terlalu banyak percobaan dari pembeli atau IP yang sama |

## Struktur repo

```
src/
  db/          skema Drizzle, koneksi @nestjs/drizzle, migrasi saat boot
  events/      event dan stok tiket
  bookings/    pesanan, pembatalan, tiket, counter penjaga, idempotensi
  payments/    simulasi bayar dan webhook
  redis/       koneksi Redis dan rate limit
  queue/       antrean BullMQ, processor kedaluwarsa, sweeper
  worker.ts    proses terpisah untuk antrean (container worker)
drizzle/       migrasi SQL hasil drizzle-kit
test/          test integrasi (Vitest + supertest)
scripts/       loadtest 200 pesanan
docker/        initdb untuk database test
```

## Konfigurasi

| Variabel | Default | Arti |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://ambaticket:ambaticket@localhost:5432/ambaticket` | koneksi Postgres |
| `REDIS_URL` | `redis://localhost:6379/0` | koneksi Redis untuk rate limit dan antrean |
| `ORDER_TTL_SECONDS` | `900` | umur pesanan sebelum kuota dilepas |
| `RATE_LIMIT_BUYER_PER_MINUTE` | `30` | batas pesanan per pembeli per menit |
| `RATE_LIMIT_IP_PER_MINUTE` | `1000` | batas pesanan per IP per menit |
| `DB_MIGRATE` | `true` | worker di compose memakai `false`, hanya API yang memigrasi |
| `PAYMENT_WEBHOOK_SECRET` | `dev-webhook-secret` | kunci HMAC webhook |
| `PORT` | `3000` | port API |

## Kenapa desainnya begini

Baca [DECISIONS.md](DECISIONS.md). Isinya alasan tiap pilihan, trade-off yang diambil, dan apa yang sengaja tidak dikerjakan.
