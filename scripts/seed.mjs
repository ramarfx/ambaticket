// Isi data demo yang enak dibaca: festival, konser, dan jazz.
//   node scripts/seed.mjs   (atau: bun scripts/seed.mjs)
// Aman dijalankan berulang: event dengan nama yang sama dilewati.
// Nama artis di bawah fiktif, silakan ganti sesuai kebutuhan demo.
const api = process.env.API ?? 'http://localhost:3000';

const events = [
  {
    name: 'Malam Jazz Kota Tua',
    venue: 'Gedung Kesenian Jakarta',
    startsAt: '2026-12-05T20:00:00+07:00',
    ticketTypes: [
      { name: 'Reguler', priceIdr: 200_000, quota: 100 },
      { name: 'Front Row', priceIdr: 400_000, quota: 3 },
    ],
  },
  {
    name: 'Festival Suara Senja 2026',
    venue: 'Lapangan Banteng, Jakarta',
    startsAt: '2026-12-12T15:00:00+07:00',
    ticketTypes: [
      { name: 'Presale', priceIdr: 250_000, quota: 50 },
      { name: 'Reguler', priceIdr: 350_000, quota: 200 },
    ],
  },
  {
    name: 'Konser Rimbawan: Amba Live',
    venue: 'Istora Senayan, Jakarta',
    startsAt: '2027-01-17T19:30:00+07:00',
    ticketTypes: [
      { name: 'Tribune', priceIdr: 450_000, quota: 100 },
      { name: 'VIP', priceIdr: 900_000, quota: 3 },
    ],
  },
  {
    name: 'Panggung Rakyat: Sagara & Nona Biru',
    venue: 'Lapangan Gasibu, Bandung',
    startsAt: '2027-02-07T16:00:00+07:00',
    ticketTypes: [
      { name: 'Festival', priceIdr: 175_000, quota: 200 },
      { name: 'VIP', priceIdr: 500_000, quota: 50 },
    ],
  },
];

const listResponse = await fetch(`${api}/events`);
if (!listResponse.ok) {
  console.error(`gagal membaca event (${listResponse.status})`);
  process.exit(1);
}
const existing = await listResponse.json();
const names = new Set(existing.map((event) => event.name));

let created = 0;
let skipped = 0;
for (const event of events) {
  if (names.has(event.name)) {
    skipped += 1;
    console.log(`lewati   : ${event.name}`);
    continue;
  }
  const response = await fetch(`${api}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    console.error(`gagal    : ${event.name} (${response.status})`);
    process.exitCode = 1;
    continue;
  }
  created += 1;
  console.log(`dibuat   : ${event.name}`);
}
console.log(`${created} event baru, ${skipped} sudah ada.`);
