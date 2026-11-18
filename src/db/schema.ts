import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  venue: text('venue').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    priceIdr: integer('price_idr').notNull(),
    quota: integer('quota').notNull(),
    // Dua kolom ini hanya penjaga penerimaan pesanan, bukan sumber kebenaran.
    // Laporan stok tetap dihitung dari tabel orders.
    heldUnits: integer('held_units').notNull().default(0),
    soldUnits: integer('sold_units').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ticket_types_event_name_key').on(table.eventId, table.name),
    check('ticket_types_price_check', sql`${table.priceIdr} >= 0`),
    check('ticket_types_quota_check', sql`${table.quota} >= 0`),
    check(
      'ticket_types_stock_check',
      sql`${table.heldUnits} >= 0 and ${table.soldUnits} >= 0 and ${table.heldUnits} + ${table.soldUnits} <= ${table.quota}`,
    ),
  ],
);

// Batas 4 tiket per event disimpan sebagai satu baris per pembeli, supaya
// pengecekannya satu UPDATE bersyarat, bukan agregat di dalam kunci.
export const buyerQuota = pgTable(
  'buyer_quota',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id').notNull(),
    liveUnits: smallint('live_units').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.buyerId] }),
    check('buyer_quota_live_check', sql`${table.liveUnits} between 0 and 4`),
  ],
);

// Di bawah ini kuota tidak disimpan sebagai counter tunggal: `held_units` dan
// `sold_units` di ticket_types dipakai sebagai penjaga, sedangkan laporan tetap
// dihitung dari orders.
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerId: text('buyer_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id),
    quantity: smallint('quantity').notNull(),
    unitPriceIdr: integer('unit_price_idr').notNull(),
    totalIdr: integer('total_idr').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('orders_ticket_type_idx').on(table.ticketTypeId),
    index('orders_buyer_event_idx').on(table.buyerId, table.eventId),
    index('orders_pending_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('orders_buyer_idempotency_key')
      .on(table.buyerId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('orders_quantity_check', sql`${table.quantity} between 1 and 4`),
    check('orders_status_check', sql`${table.status} in ('pending', 'paid', 'cancelled', 'expired')`),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    seatNo: smallint('seat_no').notNull(),
    code: text('code').notNull().unique(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tickets_order_seat_key').on(table.orderId, table.seatNo)],
);

// Id event dari provider pembayaran. Primary key di sini yang membuat webhook
// ganda tidak pernah diproses dua kali.
export const paymentEvents = pgTable('payment_events', {
  id: text('id').primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
