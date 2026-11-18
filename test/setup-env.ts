process.env.DATABASE_URL ??= 'postgres://ambaticket:ambaticket@localhost:5432/ambaticket_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'dev-webhook-secret';
