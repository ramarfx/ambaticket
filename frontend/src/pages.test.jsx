import { expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = { data: null };

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { location: { search: '', hash: '' } };

mock.module('./hooks.js', () => ({
  useApi: () => ({
    data: state.data,
    loading: false,
    error: null,
    reload: async () => {},
  }),
  useAction: () => ({
    busy: null,
    error: null,
    notice: null,
    run: async () => ({}),
  }),
}));

const { default: EventsPage } = await import('./pages/EventsPage.jsx');
const { default: EventDetailPage } = await import('./pages/EventDetailPage.jsx');
const { default: OrdersPage } = await import('./pages/OrdersPage.jsx');
const { default: TicketsPage } = await import('./pages/TicketsPage.jsx');

const startsAt = '2026-12-01T12:00:00.000Z';
const events = [
  {
    id: 'e1',
    name: 'Konser Amba',
    venue: 'Jakarta',
    startsAt,
    createdAt: startsAt,
    ticketTypes: [
      {
        eventId: 'e1',
        id: 't1',
        name: 'Reguler',
        priceIdr: 150000,
        quota: 100,
        sold: 2,
        held: 1,
        remaining: 97,
      },
      {
        eventId: 'e1',
        id: 't2',
        name: 'VIP',
        priceIdr: 500000,
        quota: 10,
        sold: 10,
        held: 0,
        remaining: 0,
      },
    ],
  },
];

test('daftar event merender data', () => {
  state.data = events;
  const html = renderToStaticMarkup(createElement(EventsPage));
  expect(html).toContain('Konser Amba');
  expect(html).toContain('sisa 97 tiket');
  expect(html).toContain('mulai');
});

test('detail event merender tipe tiket', () => {
  state.data = events[0];
  const html = renderToStaticMarkup(
    createElement(EventDetailPage, { id: 'e1' }),
  );
  expect(html).toContain('Reguler');
  expect(html).toContain('sisa 97 dari 100');
  expect(html).toContain('Habis');
  expect(html).toContain('Jumlah');
});

test('pesanan merender status dan aksi', () => {
  state.data = {
    events,
    orders: [
      {
        id: 'o1',
        eventId: 'e1',
        ticketTypeId: 't1',
        quantity: 2,
        unitPriceIdr: 150000,
        totalIdr: 300000,
        status: 'pending',
        expiresAt: startsAt,
        paidAt: null,
        createdAt: startsAt,
      },
      {
        id: 'o2',
        eventId: 'e1',
        ticketTypeId: 't1',
        quantity: 1,
        unitPriceIdr: 150000,
        totalIdr: 150000,
        status: 'paid',
        expiresAt: startsAt,
        paidAt: startsAt,
        createdAt: startsAt,
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(OrdersPage));
  expect(html).toContain('Konser Amba');
  expect(html).toContain('Menunggu bayar');
  expect(html).toContain('Lunas');
  expect(html).toContain('Bayar');
  expect(html).toContain('Batalkan');
});

test('tiket merender kode dan kursi', () => {
  state.data = [
    {
      id: 'k1',
      code: 'TKT-ABC123',
      seatNo: 1,
      issuedAt: startsAt,
      orderId: 'o2',
      eventId: 'e1',
      eventName: 'Konser Amba',
      startsAt,
      ticketTypeName: 'Reguler',
      totalIdr: 150000,
    },
  ];
  const html = renderToStaticMarkup(createElement(TicketsPage));
  expect(html).toContain('TKT-ABC123');
  expect(html).toContain('kursi 1');
  expect(html).toContain('Terbit');
});
