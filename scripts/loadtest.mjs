// Uji 200 pesanan bersamaan untuk kuota 100, dijalankan ke API yang sedang hidup:
//   node scripts/loadtest.mjs   (atau: bun scripts/loadtest.mjs)
// Alurnya: burst pesan, bayar semua yang diterima, lalu pastikan stok berakhir
// terjual 100, ditahan 0, sisa 0, dengan 100 tiket terbit.
const api = process.env.API ?? 'http://localhost:3000';
const quota = 100;
const buyers = 200;

async function send(method, path, body, buyerId) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(buyerId ? { 'x-buyer-id': buyerId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const post = (path, body, buyerId) => send('POST', path, body, buyerId);

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

const paid = await Promise.all(
  accepted.map((result) => post(`/orders/${result.body.id}/pay`)),
);
const ticketsIssued = paid.reduce(
  (total, result) => total + (result.body.tickets?.length ?? 0),
  0,
);

const detail = await send('GET', `/events/${event.body.id}`);
const stock = detail.body.ticketTypes.find((type) => type.name === 'Reguler');

const ok =
  accepted.length === quota &&
  rejected.length === buyers - quota &&
  paid.every((result) => result.status === 200) &&
  ticketsIssued === quota &&
  stock.sold === quota &&
  stock.held === 0 &&
  stock.remaining === 0;

console.log(`permintaan      : ${buyers} bersamaan, kuota ${quota}`);
console.log(`diterima (201)  : ${accepted.length}`);
console.log(`ditolak (409)   : ${rejected.length}`);
console.log(`dibayar (200)   : ${paid.filter((r) => r.status === 200).length}`);
console.log(`tiket terbit    : ${ticketsIssued}`);
console.log(
  `stok akhir      : terjual ${stock.sold}, ditahan ${stock.held}, sisa ${stock.remaining}`,
);
console.log(`waktu burst     : ${elapsed} ms`);
console.log(
  ok
    ? `HASIL: tepat ${quota} tiket terjual dan terbit, tidak ada oversell`
    : 'HASIL: TIDAK SESUAI HARAPAN',
);
process.exitCode = ok ? 0 : 1;
