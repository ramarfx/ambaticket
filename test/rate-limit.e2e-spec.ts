import { createTestApp, order, resetDb, seedEvent, type TestContext } from './helpers.js';

describe('Rate limit', () => {
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

  it('membatasi percobaan dari satu pembeli dalam satu menit', async () => {
    const event = await seedEvent(ctx.http, 100, 10);
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await order(ctx.http, 'pembeli-rakus', event.reguler.id, 1);
      statuses.push(response.status);
      if (response.status === 429) expect(response.body.code).toBe('rate_limited');
    }

    // 30 permintaan pertama lolos guard: 4 pesanan dibuat, sisanya ditolak kuota.
    expect(statuses.filter((status) => status !== 429)).toHaveLength(30);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });
});
