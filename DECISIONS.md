# Keputusan desain

Dokumen ini menjawab satu pertanyaan: kenapa sistem ini dibuat begini, dan apa yang dikorbankan.

## Ringkasan satu menit

- Kuota tidak disimpan sebagai angka. Sisa tiket dihitung dari pesanan yang masih memegang kursi.
- Setiap reservasi mengunci satu baris `events`, jadi semua pesanan pada satu event antre sebentar.
- Kedaluwarsa ditentukan waktu, bukan job. Job 30 detik cuma merapikan label status.
- Pembayaran idempoten karena status pesanan berubah di bawah row lock, ditambah ledger event id dari provider.
- Harga disalin ke pesanan saat memesan, jadi perubahan harga tidak mengubah pesanan lama.

## 1. Kuota dihitung, bukan disimpan

Sisa tiket adalah:

```
quota - jumlah tiket pada pesanan yang masih hidup
hidup = status 'paid' atau (status 'pending' dan expires_at > now())
```

Tidak ada kolom `sold` atau `held` yang di-update.

Kenapa: satu sumber kebenaran. Membatalkan pesanan cukup mengubah satu status. Melewati 15 menit tidak butuh kode sama sekali, karena `now()` sudah bergerak. Tidak ada momen di mana counter dan isi tabel tidak cocok, jadi tidak ada job rekonsiliasi.

Yang dikorbankan: setiap reservasi menjalankan satu agregat di atas pesanan tipe itu. Dengan index `orders_ticket_type_idx`, 100 pesanan berarti membaca sekitar 100 baris, hitungan milidetik. Di 10.000 pesanan per event masih satu digit milidetik. Kalau pesanan per event tumbuh ke ratusan ribu, agregat ini jadi mahal.

Kapan pindah ke counter: ketika biaya agregat terasa di latency, atau ketika jumlah baris `orders` per tipe sudah tidak muat di cache. Kalau pindah, bug baru yang harus dijaga: counter bisa melenceng kalau proses mati di tengah transisi, jadi butuh job rekonsiliasi dan aturan update yang ketat untuk setiap perubahan status. Itu pekerjaan tambahan yang belum dibutuhkan di skala 100 tiket.

## 2. Kunci di baris event, bukan baris tipe tiket

Urutan satu reservasi:

1. Baca tipe tiket (tanpa kunci) untuk tahu `event_id`, harga, kuota.
2. `select ... from events where id = ? for update`. Satu kunci per transaksi.
3. Jumlahkan tiket pembeli pada event itu yang masih hidup. Tolak kalau lewat 4.
4. Jumlahkan tiket tipe itu yang masih hidup. Tolak kalau lewat kuota.
5. Insert pesanan.

Kenapa mengunci event, bukan tipe tiket: batas 4 tiket berlaku per event, bukan per tipe. Kalau yang dikunci hanya `ticket_types`, satu pembeli yang mengirim 3 Reguler dan 2 VIP pada saat bersamaan akan mengunci dua baris berbeda, dua-duanya membaca "belum punya tiket", dan dua-duanya lolos. Dengan kunci di event, keduanya antre di baris yang sama.

Konsekuensinya: semua reservasi pada satu event berjalan bergantian. Antrean itu pendek karena transaksinya hanya beberapa query. Uji nyata: 200 pesanan bersamaan untuk kuota 100 selesai sekitar 2,5 detik dan berakhir tepat 100 diterima, 100 ditolak.

Deadlock: transaksi hanya mengambil satu kunci, jadi tidak ada urutan kunci yang bisa dibalik. Ini alasan lain memilih satu kunci besar daripada beberapa kunci kecil.

Isolation level: desain ini bergantung pada READ COMMITTED, default PostgreSQL. Setelah kunci didapat, setiap statement mengambil snapshot baru, sehingga transaksi berikutnya melihat pesanan yang baru saja di-commit pendahulunya. Kalau isolation diubah ke REPEATABLE READ, transaksi kedua tetap memakai snapshot lama dan bisa menjual tiket yang sama. SERIALIZABLE juga benar, tapi harus menangani error 40001 dan retry. Jadi: jangan ubah isolation level tanpa menjalankan ulang uji konkurensi.

## 3. Kedaluwarsa 15 menit

`expires_at` diisi saat insert dengan `now() + ORDER_TTL_SECONDS`, memakai jam database, bukan jam aplikasi.

Kebenaran kuota tidak bergantung pada job apa pun. Tepat setelah 15 menit, predikat `expires_at > now()` berhenti menghitung pesanan itu, sehingga kuota kembali sendiri.

Job `expireStale` berjalan tiap 30 detik dan hanya mengubah kolom `status` dari `pending` ke `expired`. Gunanya agar isi tabel enak dibaca dan demo kelihatan. Kalau job ini mati 3 jam:

- Kuota tetap benar, tiket tetap bisa dijual ke orang lain.
- Endpoint bayar tetap menolak pesanan itu, karena transisi membedakan status efektif di dalam kunci.
- Satu-satunya yang salah adalah kolom `status` di database, dan API tetap melaporkan `expired` karena status efektif dihitung saat dibaca.

Job dan pembayaran tidak bisa saling mendahului dengan salah: keduanya mengunci baris pesanan yang sama. `UPDATE ... WHERE status = 'pending'` milik job menunggu kunci, lalu memeriksa ulang syaratnya setelah kunci didapat. Pesanan yang sudah lunas tidak akan jadi expired.

## 4. Batas 4 tiket per event

Dihitung dari `orders` dengan predikat hidup yang sama, per `buyer_id` dan `event_id`.

Kenapa bukan dari jumlah baris `tickets`: tiket baru ada setelah bayar. Pembeli bisa memesan 4 tiket, tidak membayar, lalu memesan 4 lagi kalau hitungannya dari tiket. Dengan hitungan dari pesanan, pesanan pending ikut dihitung sampai kedaluwarsa.

Pesanan lintas tipe juga dihitung: 3 Reguler ditambah 2 VIP ditolak, karena totalnya 5. Pesanan yang dibatalkan atau kedaluwarsa membebaskan jatah lagi.

## 5. Idempotensi pembayaran

`settle` melakukan semuanya dalam satu transaksi:

1. `select ... from orders where id = ? for update`.
2. Hitung status efektif. Kalau sudah `paid`, kembalikan tiket yang ada.
3. Kalau `cancelled` atau `expired`, kembalikan alasan, tidak menerbitkan apa pun.
4. Kalau masih `pending`, terbitkan tiket, ubah status ke `paid` dan isi `paid_at`.

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

## 6. Uang

Pesanan menyimpan `unit_price_idr` dan `total_idr`, salinan dari harga saat memesan. Kalau penyelenggara menaikkan harga besok, 50 pesanan yang sudah ada tetap membayar harga lama. Salinan ini bukan duplikasi yang lupa disinkronkan, tapi snapshot kontrak: harga yang disetujui saat pesanan dibuat.

Webhook wajib menyebut `amountIdr`, dan harus sama dengan `total_idr`. Kalau tidak sama, permintaan ditolak dan tidak dicatat, sehingga provider bisa mengirim ulang dengan nominal yang benar.

## 7. Satu tipe tiket per pesanan

Kebutuhan hanya bilang "memesan 1 sampai 4 tiket", tanpa menyebut campuran tipe dalam satu pesanan.

Dengan satu tipe per pesanan, bagian kritis hanya menyentuh satu baris tipe tiket, dan alur checkout tetap satu keputusan. Yang dikorbankan: pembeli tidak bisa membeli 2 Reguler dan 1 VIP dalam satu pesanan, harus dua pesanan terpisah.

Kalau nanti diminta campuran, yang berubah: tabel `order_items` (order_id, ticket_type_id, quantity), kuota dicek per baris di dalam kunci event yang sama, dan batas 4 tiket dihitung dari jumlah semua baris. Kunci event sudah mendukung, jadi bagian sulitnya tidak berubah.

## 8. Identitas dan keamanan

- Pembeli dikenali dari header `x-buyer-id`. Ini bukan autentikasi, sesuai aturan tugas yang tidak menilai auth.
- Pesanan milik pembeli lain dibalas 404, bukan 403, supaya id pesanan tidak bisa ditebak satu per satu.
- `POST /orders/:id/pay` adalah simulasi penyedia pembayaran. Endpoint ini tidak memakai identitas pembeli karena di dunia nyata yang menandai lunas adalah provider, bukan pembeli. Jalur yang meniru provider sungguhan adalah webhook, dan webhook itu wajib bertanda tangan HMAC SHA-256 atas body mentah, dibandingkan dengan cara timing-safe.
- `request.rawBody` diambil dari opsi `rawBody: true` Nest, karena kalau memakai body yang sudah di-parse, spasi dan urutan kunci bisa berubah dan tanda tangan tidak cocok.

## 9. Skema dan migrasi

Skema ditulis di TypeScript dengan Drizzle, SQL-nya dihasilkan `drizzle-kit generate`, dan migrasi dijalankan saat API boot. Query memakai query builder Drizzle, termasuk agregat, `case`, dan `for update`, jadi bentuk data dan tipe ikut terbaca dari kode.

Koneksi memakai `DrizzleModule` dari `@nestjs/drizzle`, bukan modul buatan sendiri. Modul resmi itu membuat satu pool per aplikasi (penting karena tiap app di test e2e punya pool sendiri), menutup pool saat shutdown, dan memasang listener error pool supaya koneksi idle yang putus tidak mematikan proses. Migrasi dijalankan di dalam factory `forRootAsync`, jadi skema sudah siap sebelum provider pertama menyentuh database.

Kenapa tidak `create table if not exists` saat boot: migrasi punya urutan dan riwayat, jadi perubahan skema berikutnya tidak menebak-nebak. Catatan jujur: dua replika yang boot bersamaan masih bisa balapan di migrasi. Untuk satu container ini aman. Kalau nanti di-scale, migrasi dipisah jadi job sebelum deploy.

Aturan penting juga ditulis di database sebagai `CHECK`: jumlah tiket 1 sampai 4, status hanya empat nilai itu, harga dan kuota tidak negatif. Aplikasi tetap memvalidasi, tapi database adalah lapis terakhir yang tidak bisa dilewati kode yang salah.

## 10. Strategi uji

16 test integrasi memakai PostgreSQL sungguhan, bukan mock, karena yang diuji justru perilaku konkurensi.

- Uji 200 pesanan memakai 200 pembeli berbeda. Ini sengaja: tujuannya menguji kuota. Kalau satu pembeli, batas 4 tiket yang akan menolak lebih dulu dan uji tidak membuktikan apa pun soal kuota.
- Uji batas 4 tiket memakai satu pembeli dengan 10 permintaan bersamaan. Hasil yang ditegaskan: tepat 4 diterima, 6 ditolak `ticket_limit_exceeded`.
- Uji kedaluwarsa tidak menunggu 15 menit. Satu `UPDATE` menggeser `expires_at` ke masa lalu, lalu ditegaskan: kuota kembali, status efektif `expired`, pembayaran ditolak, pembeli lain bisa membeli, dan job menandai barisnya. Ini jujur karena semua predikat membaca waktu dari database.
- Kalau `for update` dihapus, dua uji konkurensi itu gagal atau jadi flaky. Uji berurutan tetap hijau, dan itulah alasan uji konkurensi harus ada.

Yang belum diuji: perubahan isolation level, dua replika yang boot bersamaan, dan beban di atas 200 permintaan.

## 11. Kalau skalanya 100 kali

- Serialisasi per event jadi botol pertama. Ganti dengan counter per tipe (`update ... set sold = sold + n where sold + n <= quota`) atau antrean per event, lalu pakai agregat turunan sebagai pemeriksa rekonsiliasi.
- Batas pembeli bisa memakai advisory lock per `(buyer_id, event_id)`, bukan kunci event.
- Kedaluwarsa pindah ke Redis TTL atau delayed queue, bukan sweeper.
- Webhook tetap butuh ledger idempotensi, ditambah rotasi secret dan batas waktu replay.

## 12. Yang sengaja tidak dikerjakan

- Frontend. Tugas menyebutnya opsional, dan nilai utamanya di backend.
- Autentikasi sungguhan.
- Idempotency key untuk `POST /orders`. Klik ganda menghasilkan dua pesanan pending. Dampaknya dibatasi batas 4 tiket dan kedaluwarsa 15 menit, jadi tidak worth satu tabel tambahan sekarang.
- Rate limit per IP atau identitas. Satu pembeli hanya bisa menahan 4 tiket, tapi 50 identitas palsu bisa membekukan seluruh kuota selama 15 menit. Mitigasi termurah adalah rate limit per IP dan verifikasi identitas, dan itu butuh auth yang memang tidak dinilai di tugas ini.
- Email tiket dan QR code.

## Jawaban singkat untuk demo

- "Bagaimana kuota dijaga?" Satu baris event dikunci per reservasi, lalu kuota dihitung dari pesanan yang masih hidup di dalam kunci itu. Tidak ada counter yang bisa melenceng.
- "Kenapa tidak pakai counter?" Counter lebih cepat, tapi butuh update yang tepat di setiap transisi dan job rekonsiliasi. Di 100 tiket, agregat sudah cukup dan tidak bisa salah.
- "Bagaimana kalau job kedaluwarsa mati?" Kuota tetap kembali sendiri, karena dihitung dari waktu. Job cuma merapikan label.
- "Bagaimana kalau webhook dobel?" Row lock pada pesanan plus primary key event id. Kiriman kedua mendapat tiket yang sama.
- "Bagaimana kalau webhook telat?" Dibalas 200, tidak ada tiket terbit, dan kursi yang sudah dijual ke orang lain tidak diganggu.
- "Apa yang terjadi saat 200 orang memesan?" 100 diterima, 100 ditolak, sisa 0, sekitar 2,5 detik.
