import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { orders } from '../src/db/schema.js';
import {
  createTestApp,
  getEvent,
  order,
  pay,
  resetDb,
  seedEvent,
  type TestContext,
} from './helpers.js';

describe('Pesanan dan tiket', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.db);
  });

  it('alur pesan sampai tiket terbit dengan kode unik', async () => {
    const event = await seedEvent(ctx.http, 10);

    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);
    expect(created.body).toMatchObject({
      status: 'pending',
      quantity: 2,
      unitPriceIdr: 150_000,
      totalIdr: 300_000,
    });
    expect(new Date(created.body.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 14 * 60_000,
    );

    const held = await getEvent(ctx.http, event.id).expect(200);
    expect(typeOf(held.body, 'Reguler')).toMatchObject({ sold: 0, held: 2, remaining: 8 });

    const paid = await pay(ctx.http, created.body.id).expect(200);
    expect(paid.body.applied).toBe(true);
    expect(paid.body.order.status).toBe('paid');
    expect(paid.body.tickets).toHaveLength(2);
    expect(new Set(paid.body.tickets.map((ticket: { code: string }) => ticket.code)).size).toBe(2);

    const sold = await getEvent(ctx.http, event.id).expect(200);
    expect(typeOf(sold.body, 'Reguler')).toMatchObject({ sold: 2, held: 0, remaining: 8 });

    const history = await request(ctx.http)
      .get('/orders')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(history.body).toHaveLength(1);

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(2);
    expect(tickets.body[0]).toMatchObject({ eventName: 'Konser Uji', ticketTypeName: 'Reguler' });
  });

  it('kuota habis tidak bisa dijual lebih', async () => {
    const event = await seedEvent(ctx.http, 2, 1);

    await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);

    const rejected = await order(ctx.http, 'buyer-2', event.reguler.id, 1).expect(409);
    expect(rejected.body).toMatchObject({ code: 'sold_out', remaining: 0 });

    const detail = await getEvent(ctx.http, event.id).expect(200);
    expect(typeOf(detail.body, 'Reguler')).toMatchObject({ sold: 0, held: 2, remaining: 0 });
    expect(typeOf(detail.body, 'VIP')).toMatchObject({ remaining: 1 });

    await order(ctx.http, 'buyer-2', event.vip.id, 1).expect(201);
  });

  it('batal sebelum bayar mengembalikan kuota seketika', async () => {
    const event = await seedEvent(ctx.http, 2, 1);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);

    const cancelled = await request(ctx.http)
      .post(`/orders/${created.body.id}/cancel`)
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const detail = await getEvent(ctx.http, event.id).expect(200);
    expect(typeOf(detail.body, 'Reguler')).toMatchObject({ held: 0, remaining: 2 });

    await order(ctx.http, 'buyer-2', event.reguler.id, 2).expect(201);

    const again = await request(ctx.http)
      .post(`/orders/${created.body.id}/cancel`)
      .set('x-buyer-id', 'buyer-1')
      .expect(409);
    expect(again.body.code).toBe('order_cancelled');
  });

  it('maksimal 4 tiket per event, termasuk pesanan lunas dan lintas tipe', async () => {
    const event = await seedEvent(ctx.http, 20, 20);

    await order(ctx.http, 'buyer-1', event.reguler.id, 3).expect(201);

    const over = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(409);
    expect(over.body).toMatchObject({
      code: 'ticket_limit_exceeded',
      activeTickets: 3,
      limit: 4,
    });

    const fourth = await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(201);
    await pay(ctx.http, fourth.body.id).expect(200);

    await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(409);
    const crossType = await order(ctx.http, 'buyer-1', event.vip.id, 1).expect(409);
    expect(crossType.body.code).toBe('ticket_limit_exceeded');

    const heldOrders = await request(ctx.http)
      .get('/orders')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    await request(ctx.http)
      .post(`/orders/${heldOrders.body[1].id}/cancel`)
      .set('x-buyer-id', 'buyer-1')
      .expect(200);

    await order(ctx.http, 'buyer-1', event.reguler.id, 3).expect(201);
  });

  it('pesanan kedaluwarsa mengembalikan kuota dan tidak bisa dibayar', async () => {
    const event = await seedEvent(ctx.http, 2, 1);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);

    await ctx.db
      .update(orders)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(orders.id, created.body.id));

    const detail = await getEvent(ctx.http, event.id).expect(200);
    expect(typeOf(detail.body, 'Reguler')).toMatchObject({ held: 0, remaining: 2 });

    const mine = await request(ctx.http)
      .get(`/orders/${created.body.id}`)
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(mine.body.status).toBe('expired');

    const rejected = await pay(ctx.http, created.body.id).expect(409);
    expect(rejected.body.code).toBe('order_expired');

    await order(ctx.http, 'buyer-2', event.reguler.id, 2).expect(201);

    const swept = await ctx.app.get(BookingsService).expireStale();
    expect(swept).toBe(1);
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, created.body.id));
    expect(row.status).toBe('expired');
  });

  it('bayar dua kali tetap satu set tiket', async () => {
    const event = await seedEvent(ctx.http, 10);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);

    const first = await pay(ctx.http, created.body.id).expect(200);
    const second = await pay(ctx.http, created.body.id).expect(200);
    expect(second.body.tickets.map((ticket: { code: string }) => ticket.code)).toEqual(
      first.body.tickets.map((ticket: { code: string }) => ticket.code),
    );

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(2);
  });

  it('menolak jumlah di luar 1-4 dan pesanan milik pembeli lain', async () => {
    const event = await seedEvent(ctx.http, 10);

    await order(ctx.http, 'buyer-1', event.reguler.id, 0).expect(400);
    await order(ctx.http, 'buyer-1', event.reguler.id, 5).expect(400);
    await request(ctx.http)
      .post('/orders')
      .send({ ticketTypeId: event.reguler.id, quantity: 1 })
      .expect(400);

    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(201);
    await request(ctx.http)
      .get(`/orders/${created.body.id}`)
      .set('x-buyer-id', 'buyer-2')
      .expect(404);
  });
});

function typeOf(body: any, name: string) {
  return body.ticketTypes.find((type: { name: string }) => type.name === name);
}
