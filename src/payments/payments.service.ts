import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BookingsService,
  type OrderView,
  type TicketView,
} from '../bookings/bookings.service.js';
import type { Database } from '../db/database.js';
import type { PaymentWebhookInput } from './payments.schema.js';

export type PaymentResult = {
  received: true;
  applied: boolean;
  duplicate: boolean;
  reason?: string;
  order: OrderView;
  tickets?: TicketView[];
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly bookings: BookingsService,
  ) {}

  // Simulasi penyedia pembayaran: langsung melunasi pesanan.
  async pay(orderId: string): Promise<PaymentResult> {
    const result = await this.db.transaction((tx) =>
      this.bookings.settle(tx, orderId),
    );
    if (!result.applied) {
      throw new ConflictException({
        code: result.reason,
        message:
          result.reason === 'order_expired'
            ? 'Pesanan sudah kedaluwarsa, tiket tidak diterbitkan.'
            : 'Pesanan sudah dibatalkan, tiket tidak diterbitkan.',
      });
    }
    return {
      received: true,
      applied: true,
      duplicate: result.duplicate,
      order: result.order,
      tickets: result.tickets,
    };
  }

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    payload: PaymentWebhookInput,
  ): Promise<PaymentResult> {
    if (!this.signatureValid(rawBody, signature)) {
      throw new UnauthorizedException({
        code: 'invalid_signature',
        message: 'Tanda tangan webhook tidak valid.',
      });
    }

    // Kiriman ulang tetap dijawab 200 dengan hasil yang sama, supaya provider berhenti mengulang.
    const result = await this.db.transaction((tx) =>
      this.bookings.settle(tx, payload.orderId, {
        amountIdr: payload.amountIdr,
        providerEventId: payload.eventId,
      }),
    );
    return {
      received: true,
      applied: result.applied,
      duplicate: result.duplicate,
      ...(result.applied ? {} : { reason: result.reason }),
      order: result.order,
      ...(result.applied ? { tickets: result.tickets } : {}),
    };
  }

  private signatureValid(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    if (!rawBody || !signature) return false;
    const expected = createHmac(
      'sha256',
      process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret',
    )
      .update(rawBody)
      .digest('hex');
    const provided = signature.replace(/^sha256=/, '').toLowerCase();
    return (
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    );
  }
}
