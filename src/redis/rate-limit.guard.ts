import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.module.js';

type LimitedRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

const limitFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// Jendela tetap per menit. Cukup untuk menahan klik berulang dan skrip sederhana,
// dan kalau Redis mati guard ini meloloskan permintaan: kebenaran kuota ada di database.
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly buyerLimit = limitFromEnv('RATE_LIMIT_BUYER_PER_MINUTE', 30);
  private readonly ipLimit = limitFromEnv('RATE_LIMIT_IP_PER_MINUTE', 1_000);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LimitedRequest>();
    const header = request.headers['x-buyer-id'];
    const buyerId = Array.isArray(header) ? header[0] : (header ?? 'tanpa-identitas');
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'tidak-diketahui';

    const withinBuyer = await this.allow(`rl:buyer:${buyerId}`, this.buyerLimit);
    const withinIp = await this.allow(`rl:ip:${ip}`, this.ipLimit);
    if (!withinBuyer || !withinIp) {
      throw new HttpException(
        { code: 'rate_limited', message: 'Terlalu banyak percobaan. Coba lagi sebentar lagi.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async allow(key: string, limit: number): Promise<boolean> {
    try {
      const hits = await this.redis.incr(key);
      if (hits === 1) await this.redis.pexpire(key, 60_000);
      return hits <= limit;
    } catch (error) {
      this.logger.debug(`rate limit dilewati: ${(error as Error).message}`);
      return true;
    }
  }
}
