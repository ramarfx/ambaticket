# AmbaTicket Frontend Demo

Halaman demo React + Tailwind untuk API AmbaTicket. Isinya satu halaman: daftar event, pesan tiket, bayar atau batalkan pesanan, daftar tiket, dan form untuk membuat event demo.

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
- Tidak ada autentikasi, ini hanya simulasi.

Build statis: `bun run build`, hasilnya di `dist/`.
