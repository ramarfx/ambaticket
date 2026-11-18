import type { RedisOptions } from 'ioredis';

export const redisUrl = (): string => process.env.REDIS_URL ?? 'redis://localhost:6379';

// Satu tempat menerjemahkan REDIS_URL, dipakai klien rate limit dan BullMQ.
export function redisOptions(overrides: RedisOptions = {}): RedisOptions {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...overrides,
  };
}
