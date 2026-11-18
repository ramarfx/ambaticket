import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Database, Tx } from '../db/database.js';
import {
  buyerQuota,
  events,
  orders,
  paymentEvents,
  tickets,
  ticketTypes,
  type OrderStatus,
} from '../db/schema.js';
import { ExpiryProducer } from '../queue/expiry.producer.js';
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

type UnitRow = {
  buyerId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
};

const ticketCode = (): string => `TKT-${randomBytes(6).toString('hex').toUpperCase()}`;

const ttlSeconds = (): number => Number(process.env.ORDER_TTL_SECONDS ?? 900);

// 23505 adalah pelanggaran unique index. Drizzle meneruskan error driver apa adanya.
const isUniqueViolation = (error: unknown): boolean => {
  const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly expiry: ExpiryProducer,
  ) {}

  async reserve(
    buyerId: string,
    input: CreateOrderInput,
    idempotencyKey?: string,
  ): Promise<OrderView> {
    let reserved: OrderView;
    try {
      reserved = await this.db.transaction(async (tx) => {
        const [ticketType] = await tx
          .select({ eventId: ticketTypes.eventId, priceIdr: ticketTypes.priceIdr })
          .from(ticketTypes)
          .where(eq(ticketTypes.id, input.ticketTypeId));
        if (!ticketType) {
          throw new NotFoundException({
            code: 'ticket_type_not_found',
            message: 'Tipe tiket tidak ditemukan.',
          });
        }

        if (!(await this.takeBuyerUnits(tx, buyerId, ticketType.eventId, input.quantity))) {
          // Bisa jadi jatah habis karena pesanan yang sudah lewat 15 menit belum
          // ditandai. Lepas dulu yang kedaluwarsa, lalu coba sekali lagi.
          await this.releaseExpired(
            tx,
            and(eq(orders.buyerId, buyerId), eq(orders.eventId, ticketType.eventId)),
            100,
          );
          if (!(await this.takeBuyerUnits(tx, buyerId, ticketType.eventId, input.quantity))) {
            const [quota] = await tx
              .select({ liveUnits: buyerQuota.liveUnits })
              .from(buyerQuota)
              .where(
                and(eq(buyerQuota.eventId, ticketType.eventId), eq(buyerQuota.buyerId, buyerId)),
              );
            throw new ConflictException({
              code: 'ticket_limit_exceeded',
              message: `Maksimal ${TICKET_LIMIT_PER_EVENT} tiket per event.`,
              limit: TICKET_LIMIT_PER_EVENT,
              activeTickets: quota?.liveUnits ?? 0,
              requestedTickets: input.quantity,
            });
          }
        }

        if (!(await this.takeStock(tx, input.ticketTypeId, input.quantity))) {
          await this.releaseExpired(tx, eq(orders.ticketTypeId, input.ticketTypeId), 500);
          if (!(await this.takeStock(tx, input.ticketTypeId, input.quantity))) {
            const [stock] = await tx
              .select({
                remaining: sql<number>`${ticketTypes.quota} - ${ticketTypes.heldUnits} - ${ticketTypes.soldUnits}`,
              })
              .from(ticketTypes)
              .where(eq(ticketTypes.id, input.ticketTypeId));
            throw new ConflictException({
              code: 'sold_out',
              message: `Sisa ${stock.remaining} tiket, permintaan ${input.quantity}.`,
              remaining: stock.remaining,
              requestedTickets: input.quantity,
            });
          }
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
            idempotencyKey: idempotencyKey ?? null,
            expiresAt: sql`now() + (${ttlSeconds()}::int * interval '1 second')`,
          })
          .returning(orderView);
        return order;
      });
    } catch (error) {
      // Klik ganda dengan Idempotency-Key yang sama: transaksi kedua dibatalkan
      // (termasuk counter), lalu pesanan pertama dikembalikan apa adanya.
      if (idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(buyerId, idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }

    await this.expiry.schedule(reserved.id, reserved.expiresAt);
    return reserved;
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
        .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId)))
        .for('update');
      if (!order) {
        throw new NotFoundException({
          code: 'order_not_found',
          message: 'Pesanan tidak ditemukan.',
        });
      }
      if (order.status === 'expired') await this.releaseExpired(tx, eq(orders.id, orderId), 1);
      return { ...order, tickets: await this.ticketsOfOrder(tx, orderId) };
    });
  }

  async cancel(buyerId: string, orderId: string): Promise<OrderView> {
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select({ ...orderView, buyerId: orders.buyerId })
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
        if (order.status === 'expired') await this.releaseExpired(tx, eq(orders.id, orderId), 1);
        throw new ConflictException({
          code: order.status === 'expired' ? 'order_expired' : 'order_cancelled',
          message: 'Pesanan sudah tidak aktif.',
        });
      }

      const [cancelled] = await tx
        .update(orders)
        .set({ status: 'cancelled' })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
        .returning(orderView);
      await this.releaseUnits(tx, [
        {
          buyerId: order.buyerId,
          eventId: order.eventId,
          ticketTypeId: order.ticketTypeId,
          quantity: order.quantity,
        },
      ]);
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
      if (order.status === 'expired') await this.releaseExpired(tx, eq(orders.id, orderId), 1);
      return {
        applied: false,
        duplicate,
        order,
        reason: order.status === 'expired' ? 'order_expired' : 'order_cancelled',
      };
    }

    await tx
      .update(ticketTypes)
      .set({
        heldUnits: sql`greatest(${ticketTypes.heldUnits} - ${order.quantity}, 0)`,
        soldUnits: sql`${ticketTypes.soldUnits} + ${order.quantity}`,
      })
      .where(eq(ticketTypes.id, order.ticketTypeId));

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

  // Dipakai job BullMQ. Kalau pesanan sudah lunas atau batal, tidak ada yang berubah.
  async expireOrder(orderId: string): Promise<boolean> {
    const released = await this.db.transaction((tx) =>
      this.releaseExpired(tx, eq(orders.id, orderId), 1),
    );
    if (released) this.logger.log(`pesanan ${orderId} kedaluwarsa`);
    return released > 0;
  }

  // Jaring kedua: menangkap pesanan yang job antreannya hilang. Batch dibatasi
  // supaya satu sweep tidak mengunci ribuan baris sekaligus.
  async expireStale(limit = 500): Promise<number> {
    return this.db.transaction((tx) => this.releaseExpired(tx, sql`true`, limit));
  }

  // Penjaga penerimaan: satu UPDATE bersyarat, bukan agregat. Baris nol berarti
  // permintaan ditolak, dan pemanggil yang memutuskan kode kesalahannya.
  private async takeBuyerUnits(
    tx: Tx,
    buyerId: string,
    eventId: string,
    quantity: number,
  ): Promise<boolean> {
    const rows = await tx
      .insert(buyerQuota)
      .values({ eventId, buyerId, liveUnits: quantity })
      .onConflictDoUpdate({
        target: [buyerQuota.eventId, buyerQuota.buyerId],
        set: { liveUnits: sql`${buyerQuota.liveUnits} + ${quantity}` },
        setWhere: sql`${buyerQuota.liveUnits} + ${quantity} <= ${TICKET_LIMIT_PER_EVENT}`,
      })
      .returning({ liveUnits: buyerQuota.liveUnits });
    return rows.length > 0;
  }

  private async takeStock(tx: Tx, ticketTypeId: string, quantity: number): Promise<boolean> {
    const rows = await tx
      .update(ticketTypes)
      .set({ heldUnits: sql`${ticketTypes.heldUnits} + ${quantity}` })
      .where(
        and(
          eq(ticketTypes.id, ticketTypeId),
          sql`${ticketTypes.heldUnits} + ${ticketTypes.soldUnits} + ${quantity} <= ${ticketTypes.quota}`,
        ),
      )
      .returning({ id: ticketTypes.id });
    return rows.length > 0;
  }

  private async releaseExpired(tx: Tx, where: SQL | undefined, limit: number): Promise<number> {
    const rows = await tx
      .select({
        id: orders.id,
        buyerId: orders.buyerId,
        eventId: orders.eventId,
        ticketTypeId: orders.ticketTypeId,
        quantity: orders.quantity,
      })
      .from(orders)
      .where(and(eq(orders.status, 'pending'), lte(orders.expiresAt, sql`now()`), where))
      .orderBy(orders.expiresAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return 0;

    await tx
      .update(orders)
      .set({ status: 'expired' })
      .where(inArray(orders.id, rows.map((row) => row.id)));
    await this.releaseUnits(tx, rows);
    return rows.length;
  }

  private async releaseUnits(tx: Tx, rows: UnitRow[]): Promise<void> {
    if (rows.length === 0) return;

    const perBuyer = new Map<string, { eventId: string; buyerId: string; units: number }>();
    const perType = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.eventId}:${row.buyerId}`;
      const buyer = perBuyer.get(key) ?? { eventId: row.eventId, buyerId: row.buyerId, units: 0 };
      buyer.units += row.quantity;
      perBuyer.set(key, buyer);
      perType.set(row.ticketTypeId, (perType.get(row.ticketTypeId) ?? 0) + row.quantity);
    }

    for (const buyer of perBuyer.values()) {
      await tx
        .update(buyerQuota)
        .set({ liveUnits: sql`greatest(${buyerQuota.liveUnits} - ${buyer.units}, 0)` })
        .where(
          and(
            eq(buyerQuota.eventId, buyer.eventId),
            eq(buyerQuota.buyerId, buyer.buyerId),
          ),
        );
    }
    for (const [ticketTypeId, units] of perType) {
      await tx
        .update(ticketTypes)
        .set({ heldUnits: sql`greatest(${ticketTypes.heldUnits} - ${units}, 0)` })
        .where(eq(ticketTypes.id, ticketTypeId));
    }
  }

  private async findByIdempotencyKey(
    buyerId: string,
    idempotencyKey: string,
  ): Promise<OrderView | undefined> {
    const [order] = await this.db
      .select(orderView)
      .from(orders)
      .where(and(eq(orders.buyerId, buyerId), eq(orders.idempotencyKey, idempotencyKey)));
    return order;
  }

  private async ticketsOfOrder(tx: Tx, orderId: string): Promise<TicketView[]> {
    return tx.select(ticketView).from(tickets).where(eq(tickets.orderId, orderId)).orderBy(tickets.seatNo);
  }
}
