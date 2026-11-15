import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Database, Tx } from '../db/database.js';
import {
  events,
  orders,
  paymentEvents,
  tickets,
  ticketTypes,
  type OrderStatus,
} from '../db/schema.js';
import type { CreateOrderInput } from './bookings.schema.js';

export type OrderView = {
  id: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  unitPriceIdr: number;
  totalIdr: number;
  status: OrderStatus;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
};

export type TicketView = {
  id: string;
  orderId: string;
  seatNo: number;
  code: string;
  issuedAt: Date;
};

export type SettleResult =
  | { applied: true; duplicate: boolean; order: OrderView; tickets: TicketView[] }
  | {
      applied: false;
      duplicate: boolean;
      reason: 'order_expired' | 'order_cancelled';
      order: OrderView;
    };

export const TICKET_LIMIT_PER_EVENT = 4;

// Satu definisi "kursi masih dipegang", dipakai untuk kuota, batas pembeli, dan laporan stok.
const liveOrder = () =>
  sql`(${orders.status} = 'paid' or (${orders.status} = 'pending' and ${orders.expiresAt} > now()))`;

const effectiveStatus = sql<OrderStatus>`case
  when ${orders.status} = 'pending' and ${orders.expiresAt} <= now() then 'expired'
  else ${orders.status} end`;

const orderView = {
  id: orders.id,
  eventId: orders.eventId,
  ticketTypeId: orders.ticketTypeId,
  quantity: orders.quantity,
  unitPriceIdr: orders.unitPriceIdr,
  totalIdr: orders.totalIdr,
  status: effectiveStatus,
  expiresAt: orders.expiresAt,
  paidAt: orders.paidAt,
  createdAt: orders.createdAt,
};

const ticketView = {
  id: tickets.id,
  orderId: tickets.orderId,
  seatNo: tickets.seatNo,
  code: tickets.code,
  issuedAt: tickets.issuedAt,
};

const ticketCode = (): string => `TKT-${randomBytes(6).toString('hex').toUpperCase()}`;

const ttlSeconds = (): number => Number(process.env.ORDER_TTL_SECONDS ?? 900);

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(@InjectDrizzle() private readonly db: Database) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      void this.expireStale().catch((error: unknown) =>
        this.logger.error('sweep kedaluwarsa gagal', error),
      );
    }, 30_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  async reserve(buyerId: string, input: CreateOrderInput): Promise<OrderView> {
    return this.db.transaction(async (tx) => {
      const [ticketType] = await tx
        .select({
          eventId: ticketTypes.eventId,
          priceIdr: ticketTypes.priceIdr,
          quota: ticketTypes.quota,
        })
        .from(ticketTypes)
        .where(eq(ticketTypes.id, input.ticketTypeId));
      if (!ticketType) {
        throw new NotFoundException({
          code: 'ticket_type_not_found',
          message: 'Tipe tiket tidak ditemukan.',
        });
      }

      // Satu kunci per event: cek kuota dan cek batas pembeli tidak bisa balapan.
      await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, ticketType.eventId))
        .for('update');

      const [active] = await tx
        .select({ total: sql<number>`coalesce(sum(${orders.quantity}), 0)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.buyerId, buyerId),
            eq(orders.eventId, ticketType.eventId),
            liveOrder(),
          ),
        );
      if (active.total + input.quantity > TICKET_LIMIT_PER_EVENT) {
        throw new ConflictException({
          code: 'ticket_limit_exceeded',
          message: `Maksimal ${TICKET_LIMIT_PER_EVENT} tiket per event. Kamu sudah memegang ${active.total}.`,
          activeTickets: active.total,
          requestedTickets: input.quantity,
          limit: TICKET_LIMIT_PER_EVENT,
        });
      }

      const [reserved] = await tx
        .select({ total: sql<number>`coalesce(sum(${orders.quantity}), 0)::int` })
        .from(orders)
        .where(and(eq(orders.ticketTypeId, input.ticketTypeId), liveOrder()));
      const remaining = ticketType.quota - reserved.total;
      if (input.quantity > remaining) {
        throw new ConflictException({
          code: 'sold_out',
          message: `Sisa ${remaining} tiket, permintaan ${input.quantity}.`,
          remaining,
          requestedTickets: input.quantity,
        });
      }

      const [order] = await tx
        .insert(orders)
        .values({
          buyerId,
          eventId: ticketType.eventId,
          ticketTypeId: input.ticketTypeId,
          quantity: input.quantity,
          unitPriceIdr: ticketType.priceIdr,
          totalIdr: ticketType.priceIdr * input.quantity,
          expiresAt: sql`now() + (${ttlSeconds()}::int * interval '1 second')`,
        })
        .returning(orderView);
      return order;
    });
  }

  async listMine(buyerId: string): Promise<OrderView[]> {
    return this.db
      .select(orderView)
      .from(orders)
      .where(eq(orders.buyerId, buyerId))
      .orderBy(desc(orders.createdAt))
      .limit(200);
  }

  async findMine(buyerId: string, orderId: string): Promise<OrderView & { tickets: TicketView[] }> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select(orderView)
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)));
      if (!order) {
        throw new NotFoundException({
          code: 'order_not_found',
          message: 'Pesanan tidak ditemukan.',
        });
      }
      return { ...order, tickets: await this.ticketsOfOrder(tx, orderId) };
    });
  }

  async cancel(buyerId: string, orderId: string): Promise<OrderView> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select(orderView)
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)))
        .for('update');
      if (!order) {
        throw new NotFoundException({
          code: 'order_not_found',
          message: 'Pesanan tidak ditemukan.',
        });
      }
      if (order.status === 'paid') {
        throw new ConflictException({
          code: 'order_already_paid',
          message: 'Pesanan sudah lunas dan tidak bisa dibatalkan.',
        });
      }
      if (order.status !== 'pending') {
        throw new ConflictException({
          code: order.status === 'expired' ? 'order_expired' : 'order_cancelled',
          message: 'Pesanan sudah tidak aktif.',
        });
      }
      const [cancelled] = await tx
        .update(orders)
        .set({ status: 'cancelled' })
        .where(eq(orders.id, orderId))
        .returning(orderView);
      return cancelled;
    });
  }

  async ticketsOf(buyerId: string) {
    return this.db
      .select({
        id: tickets.id,
        code: tickets.code,
        seatNo: tickets.seatNo,
        issuedAt: tickets.issuedAt,
        orderId: orders.id,
        eventId: orders.eventId,
        eventName: events.name,
        startsAt: events.startsAt,
        ticketTypeName: ticketTypes.name,
        totalIdr: orders.totalIdr,
      })
      .from(tickets)
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .innerJoin(events, eq(events.id, orders.eventId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, orders.ticketTypeId))
      .where(eq(orders.buyerId, buyerId))
      .orderBy(desc(tickets.issuedAt));
  }

  async settle(
    tx: Tx,
    orderId: string,
    options: { amountIdr?: number; providerEventId?: string } = {},
  ): Promise<SettleResult> {
    const [order] = await tx
      .select(orderView)
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) {
      throw new NotFoundException({ code: 'order_not_found', message: 'Pesanan tidak ditemukan.' });
    }

    if (options.amountIdr !== undefined && options.amountIdr !== order.totalIdr) {
      throw new ConflictException({
        code: 'amount_mismatch',
        message: `Nominal ${options.amountIdr} tidak sama dengan total pesanan ${order.totalIdr}.`,
        expectedIdr: order.totalIdr,
        receivedIdr: options.amountIdr,
      });
    }

    // Ledger event: kiriman kedua dengan id yang sama tidak mengubah apa pun.
    let duplicate = false;
    if (options.providerEventId) {
      const inserted = await tx
        .insert(paymentEvents)
        .values({ id: options.providerEventId, orderId })
        .onConflictDoNothing()
        .returning({ id: paymentEvents.id });
      duplicate = inserted.length === 0;
    }

    if (order.status === 'paid') {
      return {
        applied: true,
        duplicate,
        order,
        tickets: await this.ticketsOfOrder(tx, orderId),
      };
    }
    if (order.status !== 'pending') {
      return {
        applied: false,
        duplicate,
        order,
        reason: order.status === 'expired' ? 'order_expired' : 'order_cancelled',
      };
    }

    await tx
      .insert(tickets)
      .values(
        Array.from({ length: order.quantity }, (_, index) => ({
          orderId,
          seatNo: index + 1,
          code: ticketCode(),
        })),
      )
      .onConflictDoNothing();
    const [paid] = await tx
      .update(orders)
      .set({ status: 'paid', paidAt: sql`now()` })
      .where(eq(orders.id, orderId))
      .returning(orderView);
    return {
      applied: true,
      duplicate,
      order: paid,
      tickets: await this.ticketsOfOrder(tx, orderId),
    };
  }

  // Job ini cuma merapikan kolom status untuk tampilan. Kebenaran kuota tidak
  // bergantung padanya, karena kuota dihitung dari expires_at.
  async expireStale(): Promise<number> {
    const expired = await this.db
      .update(orders)
      .set({ status: 'expired' })
      .where(and(eq(orders.status, 'pending'), sql`${orders.expiresAt} <= now()`))
      .returning({ id: orders.id });
    if (expired.length) this.logger.log(`${expired.length} pesanan kedaluwarsa ditandai`);
    return expired.length;
  }

  private async ticketsOfOrder(tx: Tx, orderId: string): Promise<TicketView[]> {
    return tx.select(ticketView).from(tickets).where(eq(tickets.orderId, orderId)).orderBy(tickets.seatNo);
  }
}
