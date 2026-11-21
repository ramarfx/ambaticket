import { useCallback, useEffect, useState } from 'react';
import {
  buyerId,
  cancelOrder,
  createEvent,
  createOrder,
  getEvents,
  getOrders,
  getTickets,
  payOrder,
} from './api.js';

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const tanggal = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const statusText = {
  pending: 'Menunggu bayar',
  paid: 'Lunas',
  cancelled: 'Dibatalkan',
  expired: 'Kedaluwarsa',
};

const statusClass = {
  pending: 'text-stamp',
  paid: 'text-ink',
  cancelled: 'text-ink-muted',
  expired: 'text-ink-muted',
};

const btn =
  'inline-flex min-h-11 items-center justify-center border px-4 text-sm font-medium transition-colors';
const btnPrimary = `${btn} border-stamp bg-stamp text-paper hover:border-stamp-dark hover:bg-stamp-dark`;
const btnGhost = `${btn} border-rule bg-transparent text-ink hover:border-ink`;
const field = 'min-h-11 w-full border border-rule bg-paper px-3 text-sm';

function Panel({ title, note, children }) {
  return (
    <section className="border border-rule bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note ? (
          <p className="font-mono text-xs text-ink-muted">{note}</p>
        ) : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function TicketRow({ type, onOrder, busy }) {
  const [quantity, setQuantity] = useState(1);
  const max = Math.min(4, type.remaining);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-rule py-3 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-medium">{type.name}</p>
        <p className="font-mono text-xs text-ink-muted">
          {rupiah.format(type.priceIdr)} · sisa {type.remaining} dari{' '}
          {type.quota}
        </p>
      </div>
      {type.remaining < 1 ? (
        <p className="font-mono text-xs text-stamp">Habis</p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onOrder(type.id, quantity);
          }}
        >
          <label htmlFor={`jumlah-${type.id}`} className="text-xs text-ink-muted">
            Jumlah
          </label>
          <select
            id={`jumlah-${type.id}`}
            className={`${field} w-20`}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          >
            {Array.from({ length: max }, (_, index) => index + 1).map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
          <button type="submit" className={btnGhost} disabled={busy}>
            Pesan
          </button>
        </form>
      )}
    </li>
  );
}

function CreateEventForm({ onCreate }) {
  const [form, setForm] = useState({
    name: '',
    venue: '',
    startsAt: '',
    typeName: 'Reguler',
    priceIdr: '50000',
    quota: '20',
  });
  const [submitting, setSubmitting] = useState(false);

  const update = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    const created = await onCreate({
      name: form.name.trim(),
      venue: form.venue.trim(),
      startsAt: new Date(form.startsAt).toISOString(),
      ticketTypes: [
        {
          name: form.typeName.trim(),
          priceIdr: Number(form.priceIdr),
          quota: Number(form.quota),
        },
      ],
    });
    setSubmitting(false);
    if (created) {
      setForm((current) => ({
        ...current,
        name: '',
        venue: '',
        startsAt: '',
      }));
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="event-name" className="text-xs text-ink-muted">
            Nama event
          </label>
          <input
            id="event-name"
            className={`${field} mt-1`}
            required
            minLength={3}
            maxLength={200}
            value={form.name}
            onChange={update('name')}
          />
        </div>
        <div>
          <label htmlFor="event-venue" className="text-xs text-ink-muted">
            Lokasi
          </label>
          <input
            id="event-venue"
            className={`${field} mt-1`}
            required
            minLength={3}
            maxLength={200}
            value={form.venue}
            onChange={update('venue')}
          />
        </div>
        <div>
          <label htmlFor="event-starts" className="text-xs text-ink-muted">
            Mulai
          </label>
          <input
            id="event-starts"
            type="datetime-local"
            className={`${field} mt-1`}
            required
            value={form.startsAt}
            onChange={update('startsAt')}
          />
        </div>
        <div>
          <label htmlFor="event-type" className="text-xs text-ink-muted">
            Tipe tiket
          </label>
          <input
            id="event-type"
            className={`${field} mt-1`}
            required
            maxLength={40}
            value={form.typeName}
            onChange={update('typeName')}
          />
        </div>
        <div>
          <label htmlFor="event-price" className="text-xs text-ink-muted">
            Harga (Rp)
          </label>
          <input
            id="event-price"
            type="number"
            className={`${field} mt-1`}
            required
            min={0}
            step={1000}
            value={form.priceIdr}
            onChange={update('priceIdr')}
          />
        </div>
        <div>
          <label htmlFor="event-quota" className="text-xs text-ink-muted">
            Kuota
          </label>
          <input
            id="event-quota"
            type="number"
            className={`${field} mt-1`}
            required
            min={1}
            value={form.quota}
            onChange={update('quota')}
          />
        </div>
      </div>
      <button type="submit" className={btnPrimary} disabled={submitting}>
        {submitting ? 'Menyimpan...' : 'Buat event demo'}
      </button>
    </form>
  );
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextEvents, nextOrders, nextTickets] = await Promise.all([
        getEvents(),
        getOrders(),
        getTickets(),
      ]);
      setEvents(nextEvents);
      setOrders(nextOrders);
      setTickets(nextTickets);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key, action, message) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const eventById = new Map(events.map((event) => [event.id, event]));
  const empty = (label) => (
    <p className="text-sm text-ink-muted">
      {loading ? 'Memuat data...' : label}
    </p>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">AmbaTicket</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Pesan tiket, bayar, lalu tiket terbit dengan kode sendiri.
          </p>
        </div>
        <p className="font-mono text-xs text-ink-muted">
          pembeli {buyerId.slice(0, 8)}
        </p>
      </header>

      <main className="mt-6 space-y-6">
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border border-stamp bg-stamp/5 px-4 py-3 text-sm text-stamp"
          >
            <p>{error}</p>
            <button
              type="button"
              className={btnGhost}
              onClick={() => void load()}
            >
              Coba lagi
            </button>
          </div>
        ) : null}

        {notice ? (
          <p role="status" className="border border-rule bg-card px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}

        <Panel title="Event" note="kuota dihitung dari pesanan aktif">
          {events.length === 0
            ? empty('Belum ada event. Buat event demo di bawah.')
            : (
              <ul className="space-y-4">
                {events.map((event) => (
                  <li key={event.id} className="border border-rule">
                    <div className="border-b border-rule px-4 py-3">
                      <h3 className="text-base font-semibold">{event.name}</h3>
                      <p className="mt-1 text-xs text-ink-muted">
                        {event.venue} ·{' '}
                        <time dateTime={event.startsAt}>
                          {tanggal.format(new Date(event.startsAt))}
                        </time>
                      </p>
                    </div>
                    <ul className="px-4 py-3">
                      {event.ticketTypes.map((type) => (
                        <TicketRow
                          key={type.id}
                          type={type}
                          busy={busy === type.id}
                          onOrder={(ticketTypeId, quantity) =>
                            run(
                              ticketTypeId,
                              () => createOrder({ ticketTypeId, quantity }),
                              'Pesanan dibuat. Selesaikan pembayaran dalam 15 menit.',
                            )
                          }
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Pesanan saya" note={`${orders.length} pesanan`}>
          {orders.length === 0
            ? empty('Belum ada pesanan. Pilih tipe tiket di atas.')
            : (
              <ul className="space-y-3">
                {orders.map((order) => {
                  const event = eventById.get(order.eventId);
                  const type = event?.ticketTypes.find(
                    (item) => item.id === order.ticketTypeId,
                  );
                  return (
                    <li key={order.id} className="border border-rule px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {event?.name ?? 'Event'} · {type?.name ?? 'Tiket'}
                          </p>
                          <p className="font-mono text-xs text-ink-muted">
                            {order.quantity} tiket ·{' '}
                            {rupiah.format(order.totalIdr)}
                          </p>
                        </div>
                        <p
                          className={`font-mono text-xs ${
                            statusClass[order.status] ?? 'text-ink'
                          }`}
                        >
                          {statusText[order.status] ?? order.status}
                        </p>
                      </div>
                      {order.status === 'pending' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <p className="mr-auto font-mono text-xs text-ink-muted">
                            bayar sebelum{' '}
                            {tanggal.format(new Date(order.expiresAt))}
                          </p>
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={busy === `pay-${order.id}`}
                            onClick={() =>
                              run(
                                `pay-${order.id}`,
                                () => payOrder(order.id),
                                'Pembayaran diterima, tiket diterbitkan.',
                              )
                            }
                          >
                            {busy === `pay-${order.id}`
                              ? 'Memproses...'
                              : 'Bayar'}
                          </button>
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={busy === `cancel-${order.id}`}
                            onClick={() =>
                              run(
                                `cancel-${order.id}`,
                                () => cancelOrder(order.id),
                                'Pesanan dibatalkan.',
                              )
                            }
                          >
                            Batalkan
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
        </Panel>

        <Panel title="Tiket saya" note={`${tickets.length} tiket`}>
          {tickets.length === 0
            ? empty('Tiket muncul di sini setelah pesanan dibayar.')
            : (
              <ul className="space-y-3">
                {tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="border border-rule px-4 py-3"
                  >
                    <p className="font-mono text-sm font-medium">
                      {ticket.code}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {ticket.eventName} · {ticket.ticketTypeName} · kursi{' '}
                      {ticket.seatNo}
                    </p>
                    <p className="font-mono text-xs text-ink-muted">
                      terbit {tanggal.format(new Date(ticket.issuedAt))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Buat event demo" note="satu tipe tiket per event">
          <CreateEventForm
            onCreate={(input) =>
              run(
                'create-event',
                () => createEvent(input),
                'Event demo dibuat.',
              )
            }
          />
        </Panel>
      </main>

      <footer className="mt-12 border-t border-rule pt-4 text-xs text-ink-muted">
        Pembayaran disimulasikan lewat endpoint /pay. Tidak ada autentikasi,
        pembeli dikenali dari id di localStorage.
      </footer>
    </div>
  );
}
