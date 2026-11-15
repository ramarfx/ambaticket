import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { orders } from '../src/db/schema.js';
import { createTestApp, getEvent, order, resetDb, seedEvent, type TestContext } from './helpers.js';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret';

function sendWebhook(http: App, payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  return request(http)
    .post('/webhooks/payments')
    .set('content-type', 'application/json')
    .set(
      'x-payment-signature',
      signature ?? createHmac('sha256', SECRET).update(raw).digest('hex'),
    )
    .send(raw);
}

describe('Webhook pembayaran', () => {
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

  it('menolak tanda tangan yang salah', async () => {
    const event = await seedEvent(ctx.http);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(201);

    const response = await sendWebhook(
      ctx.http,
      {
        eventId: 'evt-1',
        orderId: created.body.id,
        type: 'payment.succeeded',
        amountIdr: 150_000,
      },
      'deadbeef',
    ).expect(401);
    expect(response.body.code).toBe('invalid_signature');
  });

  it('kiriman ganda menghasilkan tiket yang sama sekali', async () => {
    const event = await seedEvent(ctx.http);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);
    const payload = {
      eventId: 'evt-1',
      orderId: created.body.id,
      type: 'payment.succeeded',
      amountIdr: 300_000,
    };

    const first = await sendWebhook(ctx.http, payload).expect(200);
    expect(first.body).toMatchObject({ received: true, applied: true, duplicate: false });

    const second = await sendWebhook(ctx.http, payload).expect(200);
    expect(second.body).toMatchObject({ received: true, applied: true, duplicate: true });
    expect(second.body.tickets).toEqual(first.body.tickets);

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(2);
  });

  it('event id berbeda untuk pesanan yang sama tidak menambah tiket', async () => {
    const event = await seedEvent(ctx.http);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(201);
    const base = {
      orderId: created.body.id,
      type: 'payment.succeeded',
      amountIdr: 150_000,
    };

    await sendWebhook(ctx.http, { ...base, eventId: 'evt-1' }).expect(200);
    const again = await sendWebhook(ctx.http, { ...base, eventId: 'evt-2' }).expect(200);
    expect(again.body.duplicate).toBe(false);

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(1);
  });

  it('webhook yang datang setelah kedaluwarsa tidak menerbitkan tiket', async () => {
    const event = await seedEvent(ctx.http, 2, 1);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);

    await ctx.db
      .update(orders)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(orders.id, created.body.id));

    const response = await sendWebhook(ctx.http, {
      eventId: 'evt-late',
      orderId: created.body.id,
      type: 'payment.succeeded',
      amountIdr: 300_000,
    }).expect(200);
    expect(response.body).toMatchObject({ received: true, applied: false, reason: 'order_expired' });
    expect(response.body.tickets).toBeUndefined();

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(0);

    await order(ctx.http, 'buyer-2', event.reguler.id, 2).expect(201);
  });

  it('nominal yang tidak cocok ditolak dan event id masih bisa dipakai ulang', async () => {
    const event = await seedEvent(ctx.http);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 1).expect(201);
    const payload = {
      eventId: 'evt-amount',
      orderId: created.body.id,
      type: 'payment.succeeded',
    };

    const mismatch = await sendWebhook(ctx.http, { ...payload, amountIdr: 1_000 }).expect(409);
    expect(mismatch.body.code).toBe('amount_mismatch');

    const fixed = await sendWebhook(ctx.http, { ...payload, amountIdr: 150_000 }).expect(200);
    expect(fixed.body.applied).toBe(true);
  });

  it('lima webhook identik yang datang bersamaan hanya menerbitkan satu set tiket', async () => {
    const event = await seedEvent(ctx.http);
    const created = await order(ctx.http, 'buyer-1', event.reguler.id, 2).expect(201);
    const payload = {
      eventId: 'evt-race',
      orderId: created.body.id,
      type: 'payment.succeeded',
      amountIdr: 300_000,
    };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => sendWebhook(ctx.http, payload)),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const tickets = await request(ctx.http)
      .get('/tickets')
      .set('x-buyer-id', 'buyer-1')
      .expect(200);
    expect(tickets.body).toHaveLength(2);

    const sold = await getEvent(ctx.http, event.id).expect(200);
    expect(sold.body.ticketTypes.find((type: { name: string }) => type.name === 'Reguler')).toMatchObject(
      { sold: 2, held: 0 },
    );
  });
});
