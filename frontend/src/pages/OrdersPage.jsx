import { cancelOrder, getEvents, getOrders, payOrder } from '../api.js';
import { statusClass, statusText, rupiah, tanggal } from '../format.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, Notice, PageHeader, btnGhost, btnPrimary } from '../ui.jsx';

export default function OrdersPage() {
  const { data, loading, error, reload } = useApi(async () => {
    const [orders, events] = await Promise.all([getOrders(), getEvents()]);
    return { orders, events };
  }, []);
  const {
    busy,
    error: actionError,
    notice,
    run,
  } = useAction();

  const eventById = new Map(
    (data?.events ?? []).map((event) => [event.id, event]),
  );

  const act = async (key, action, message) => {
    if (await run(key, action, message)) await reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pesanan saya"
        description="Bayar sebelum waktu habis, atau batalkan untuk melepas kuota."
        actions={
          <a href="#/" className={btnGhost}>
            Pesan tiket
          </a>
        }
      />

      {error || actionError ? (
        <Notice kind="error" retry={reload}>
          {error ?? actionError}
        </Notice>
      ) : null}

      {notice ? <Notice>{notice}</Notice> : null}

      {!data?.orders.length ? (
        <Empty loading={loading} label="Belum ada pesanan." />
      ) : (
        <section aria-label="Daftar pesanan" className="border border-rule bg-card">
          <div className="hidden grid-cols-[minmax(0,1fr)_7rem_8rem_11rem] gap-4 border-b border-rule px-5 py-2 text-xs text-ink-muted md:grid">
            <span>Pesanan</span>
            <span>Total</span>
            <span>Status</span>
            <span>Aksi</span>
          </div>
          <ul>
            {data?.orders.map((order) => {
              const event = eventById.get(order.eventId);
              const type = event?.ticketTypes.find(
                (item) => item.id === order.ticketTypeId,
              );
              return (
                <li
                  key={order.id}
                  className="grid gap-2 border-b border-rule px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem] md:items-center md:gap-4"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {event?.name ?? 'Event'} · {type?.name ?? 'Tiket'}
                    </p>
                    <p className="font-mono text-xs text-ink-muted">
                      {order.quantity} tiket
                      {order.status === 'pending'
                        ? ` · bayar sebelum ${tanggal.format(
                            new Date(order.expiresAt),
                          )}`
                        : ''}
                    </p>
                  </div>
                  <p className="font-mono text-sm">
                    {rupiah.format(order.totalIdr)}
                  </p>
                  <p
                    className={`font-mono text-xs ${
                      statusClass[order.status] ?? 'text-ink'
                    }`}
                  >
                    {statusText[order.status] ?? order.status}
                  </p>
                  {order.status === 'pending' ? (
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={busy === `pay-${order.id}`}
                        onClick={() =>
                          act(
                            `pay-${order.id}`,
                            () => payOrder(order.id),
                            'Pembayaran diterima, tiket diterbitkan.',
                          )
                        }
                      >
                        {busy === `pay-${order.id}` ? 'Memproses...' : 'Bayar'}
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={busy === `cancel-${order.id}`}
                        onClick={() =>
                          act(
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
        </section>
      )}
    </div>
  );
}
