import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Database } from '../src/db/database.js';
import {
  events,
  orders,
  paymentEvents,
  tickets,
  ticketTypes,
} from '../src/db/schema.js';

export type TestContext = {
  app: INestApplication<App>;
  http: App;
  db: Database;
};

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.listen(0);
  return {
    app,
    http: app.getHttpServer(),
    db: app.get<Database>(getDrizzleToken()),
  };
}

export async function resetDb(db: Database): Promise<void> {
  await db.delete(paymentEvents);
  await db.delete(tickets);
  await db.delete(orders);
  await db.delete(ticketTypes);
  await db.delete(events);
}

export type SeededEvent = {
  id: string;
  reguler: { id: string; quota: number; priceIdr: number };
  vip: { id: string; quota: number; priceIdr: number };
};

export async function seedEvent(
  http: App,
  quota = 10,
  vipQuota = 4,
): Promise<SeededEvent> {
  const response = await request(http)
    .post('/events')
    .send({
      name: 'Konser Uji',
      venue: 'Jakarta',
      startsAt: '2026-12-01T19:00:00+07:00',
      ticketTypes: [
        { name: 'Reguler', priceIdr: 150_000, quota },
        { name: 'VIP', priceIdr: 500_000, quota: vipQuota },
      ],
    })
    .expect(201);
  const body = response.body;
  const reguler = body.ticketTypes.find(
    (type: { name: string }) => type.name === 'Reguler',
  );
  const vip = body.ticketTypes.find(
    (type: { name: string }) => type.name === 'VIP',
  );
  return { id: body.id, reguler, vip };
}

export const order = (
  http: App,
  buyerId: string,
  ticketTypeId: string,
  quantity = 1,
) =>
  request(http)
    .post('/orders')
    .set('x-buyer-id', buyerId)
    .send({ ticketTypeId, quantity });

export const pay = (http: App, orderId: string) =>
  request(http).post(`/orders/${orderId}/pay`);

export const getEvent = (http: App, eventId: string) =>
  request(http).get(`/events/${eventId}`);
