# AmbaTicket Frontend Demo

Halaman demo React + Tailwind untuk API AmbaTicket. Bentuknya aplikasi desktop dengan sidebar dan halaman terpisah:

- `#/` daftar event
- `#/events/:id` detail event dan pemesanan tiket
- `#/orders` pesanan saya, dengan aksi bayar dan batalkan
- `#/tickets` tiket yang sudah terbit
- `#/events/new` form buat event demo

## Jalankan

API harus hidup di `http://localhost:3000` (lihat README utama). Lalu:

```bash
bun install
bun run dev
```

Buka `http://localhost:5173`. Vite mem-proxy `/api` ke `localhost:3000`, jadi backend tidak perlu diubah untuk CORS.

## Catatan demo

- Identitas pembeli disimpan di `localStorage` dan dikirim lewat header `x-buyer-id`. Parameter `?buyer=` menimpa nilai itu per tab.
- Pesanan menahan tiket selama 15 menit. Tombol Bayar memanggil `POST /orders/:id/pay`.
- Navigasi memakai hash, jadi tidak ada dependensi router.
- Tidak ada autentikasi, ini hanya simulasi.

## Demo beberapa pembeli sekaligus

Pembeli bisa diganti dari dropdown di sidebar, atau langsung lewat URL. Untuk
tiga pembeli berbeda di tiga tab, buka:

```
http://localhost:5173/?buyer=demo-1#/events/<id-event>
http://localhost:5173/?buyer=demo-2#/events/<id-event>
http://localhost:5173/?buyer=demo-3#/events/<id-event>
```

Buat event dengan kuota kecil (misalnya 1 atau 2) lewat menu Buat event, buka
tiga tab itu, lalu klik Pesan berdekatan. Satu tab mendapat pesanan, sisanya
menerima pesan sisa tiket habis. Parameter `?buyer=` tetap terbawa saat
berpindah halaman lewat navigasi.

Tiga klik manual bukan uji konkurensi. Untuk bukti 200 pesanan bersamaan,
jalankan `node scripts/loadtest.mjs` dari root repo.

Build statis: `bun run build`, hasilnya di `dist/`. Test render halaman: `bun test`.
