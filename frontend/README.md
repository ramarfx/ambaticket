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

- Identitas pembeli dibuat sekali di `localStorage` dan dikirim lewat header `x-buyer-id`.
- Pesanan menahan tiket selama 15 menit. Tombol Bayar memanggil `POST /orders/:id/pay`.
- Navigasi memakai hash, jadi tidak ada dependensi router.
- Tidak ada autentikasi, ini hanya simulasi.

Build statis: `bun run build`, hasilnya di `dist/`. Test render halaman: `bun test`.
