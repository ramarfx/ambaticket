import { and, eq, sql } from 'drizzle-orm';
import { orders, ticketTypes } from '../src/db/schema.js';
import { createTestApp, getEvent, order, resetDb, seedEvent, type TestContext } from './helpers.js';

describe('Kuota di bawah tekanan', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx);
  });

  it('200 pesanan bersamaan untuk kuota 100 berakhir tepat 100', async () => {
    const event = await seedEvent(ctx.http, 100, 10);

    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        order(ctx.http, `buyer-${index}`, event.reguler.id, 1),
      ),
    );

    const accepted = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status === 409);
    expect(accepted).toHaveLength(100);
    expect(rejected).toHaveLength(100);
    expect(rejected.every((response) => response.body.code === 'sold_out')).toBe(true);

    const detail = await getEvent(ctx.http, event.id).expect(200);
    expect(detail.body.ticketTypes.find((type: { name: string }) => type.name === 'Reguler')).toMatchObject(
      { sold: 0, held: 100, remaining: 0 },
    );

    const [total] = await ctx.db
      .select({ quantity: sql<number>`sum(${orders.quantity})::int` })
      .from(orders)
      .where(eq(orders.ticketTypeId, event.reguler.id));
    expect(total.quantity).toBe(100);

    const [counter] = await ctx.db
      .select({ held: ticketTypes.heldUnits, sold: ticketTypes.soldUnits })
      .from(ticketTypes)
      .where(eq(ticketTypes.id, event.reguler.id));
    expect(counter).toEqual({ held: 100, sold: 0 });
  });

  it('10 pesanan bersamaan dari satu pembeli berhenti di 4 tiket', async () => {
    const event = await seedEvent(ctx.http, 50, 10);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => order(ctx.http, 'pembeli-serakah', event.reguler.id, 1)),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(4);
    const rejected = responses.filter((response) => response.status === 409);
    expect(rejected).toHaveLength(6);
    expect(rejected.every((response) => response.body.code === 'ticket_limit_exceeded')).toBe(true);

    const [total] = await ctx.db
      .select({ quantity: sql<number>`sum(${orders.quantity})::int` })
      .from(orders)
      .where(
        and(
          eq(orders.buyerId, 'pembeli-serakah'),
          eq(orders.eventId, event.id),
          sql`${orders.status} = 'pending'`,
        ),
      );
    expect(total.quantity).toBe(4);
  });
});
