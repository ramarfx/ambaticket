// Uji pesanan bersamaan untuk kuota terbatas, dijalankan ke API yang sedang hidup:
//   node scripts/loadtest.mjs
//   BUYERS=500 QUOTA=500 node scripts/loadtest.mjs
// Batas rate limit per IP (default 1000 per menit) ikut menentukan; jalankan sekali per menit.
const api = process.env.API ?? 'http://localhost:3000';
const quota = Number(process.env.QUOTA ?? 100);
const buyers = Number(process.env.BUYERS ?? 200);

async function post(path, body, buyerId) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(buyerId ? { 'x-buyer-id': buyerId } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const event = await post('/events', {
  name: `Load test ${new Date().toISOString()}`,
  venue: 'Jakarta',
  startsAt: '2026-12-01T19:00:00+07:00',
  ticketTypes: [
    { name: 'Reguler', priceIdr: 150_000, quota },
    { name: 'VIP', priceIdr: 500_000, quota: 10 },
  ],
});
const reguler = event.body.ticketTypes.find((type) => type.name === 'Reguler');

const startedAt = Date.now();
const results = await Promise.all(
  Array.from({ length: buyers }, (_, index) =>
    post('/orders', { ticketTypeId: reguler.id, quantity: 1 }, `load-${index}`),
  ),
);
const elapsed = Date.now() - startedAt;

const accepted = results.filter((result) => result.status === 201);
const rejected = results.filter((result) => result.status === 409);
const detail = await (await fetch(`${api}/events/${event.body.id}`)).json();
const stock = detail.ticketTypes.find((type) => type.name === 'Reguler');

console.log(`permintaan      : ${buyers} bersamaan, kuota ${quota}`);
console.log(`diterima (201)  : ${accepted.length}`);
console.log(`ditolak (409)   : ${rejected.length}`);
console.log(`sisa kuota      : ${stock.remaining}, terjual ${stock.sold}, ditahan ${stock.held}`);
console.log(`waktu total     : ${elapsed} ms`);
console.log(
  accepted.length === quota && rejected.length === buyers - quota && stock.remaining === 0
    ? `HASIL: tepat ${quota} terjual, tidak ada oversell`
    : 'HASIL: TIDAK SESUAI HARAPAN',
);
