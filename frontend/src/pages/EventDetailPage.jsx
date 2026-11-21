import { useState } from 'react';
import { createOrder, getEvent } from '../api.js';
import { useAction, useApi } from '../hooks.js';
import { rupiah, tanggal } from '../format.js';
import { Empty, Notice, PageHeader, btnGhost, field } from '../ui.jsx';

function TicketRow({ type, onOrder, busy }) {
  const [quantity, setQuantity] = useState(1);
  const max = Math.min(4, type.remaining);

  return (
    <li className="grid gap-3 border-t border-dashed border-rule py-4 first:border-t-0 first:pt-0 md:grid-cols-[1fr_auto] md:items-center">
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
          className="flex flex-wrap items-center gap-2 md:justify-end"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onOrder(type.id, quantity)) setQuantity(1);
          }}
        >
          <label
            htmlFor={`jumlah-${type.id}`}
            className="text-xs text-ink-muted"
          >
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

export default function EventDetailPage({ id }) {
  const { data: event, loading, error, reload } = useApi(
    () => getEvent(id),
    [id],
  );
  const {
    busy,
    error: actionError,
    notice,
    run,
  } = useAction();

  const order = (ticketTypeId, quantity) =>
    run(
      ticketTypeId,
      () => createOrder({ ticketTypeId, quantity }),
      'Pesanan dibuat. Selesaikan pembayaran dalam 15 menit.',
    ).then(async (created) => {
      if (created) await reload();
      return Boolean(created);
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={event?.name ?? 'Detail event'}
        description={
          event
            ? `${event.venue} · ${tanggal.format(new Date(event.startsAt))}`
            : undefined
        }
        actions={
          <a href="#/" className={btnGhost}>
            Semua event
          </a>
        }
      />

      {error || actionError ? (
        <Notice kind="error" retry={reload}>
          {error ?? actionError}
        </Notice>
      ) : null}

      {notice ? (
        <Notice>
          {notice}{' '}
          <a href="#/orders" className="underline underline-offset-2">
            Lihat pesanan
          </a>
        </Notice>
      ) : null}

      <section
        aria-label="Tipe tiket"
        className="border border-rule bg-card"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-5 py-3">
          <h2 className="text-sm font-semibold">Tipe tiket</h2>
          <p className="font-mono text-xs text-ink-muted">
            maksimal 4 tiket per pembeli
          </p>
        </header>
        <div className="px-5 py-4">
          {!event ? (
            <Empty loading={loading} label="Event tidak tersedia." />
          ) : (
            <ul>
              {event.ticketTypes.map((type) => (
                <TicketRow
                  key={type.id}
                  type={type}
                  busy={busy === type.id}
                  onOrder={order}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
