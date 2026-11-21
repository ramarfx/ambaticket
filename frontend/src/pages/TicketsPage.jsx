import { getTickets } from '../api.js';
import { tanggal } from '../format.js';
import { useApi } from '../hooks.js';
import { Empty, Notice, PageHeader, btnGhost } from '../ui.jsx';

export default function TicketsPage() {
  const { data: tickets, loading, error, reload } = useApi(getTickets, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tiket saya"
        description="Tiket terbit setelah pesanan dibayar, satu kode per kursi."
        actions={
          <a href="#/orders" className={btnGhost}>
            Lihat pesanan
          </a>
        }
      />

      {error ? (
        <Notice kind="error" retry={reload}>
          {error}
        </Notice>
      ) : null}

      {!tickets?.length ? (
        <Empty loading={loading} label="Belum ada tiket. Bayar pesanan dulu." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {tickets?.map((ticket) => (
            <li key={ticket.id} className="border border-rule bg-card p-5">
              <p className="font-mono text-base font-semibold">{ticket.code}</p>
              <h2 className="mt-3 text-sm font-semibold">
                {ticket.eventName}
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                {ticket.ticketTypeName} · kursi {ticket.seatNo}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-dashed border-rule pt-3">
                <div>
                  <dt className="text-xs text-ink-muted">Mulai</dt>
                  <dd className="font-mono text-xs">
                    {tanggal.format(new Date(ticket.startsAt))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Terbit</dt>
                  <dd className="font-mono text-xs">
                    {tanggal.format(new Date(ticket.issuedAt))}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
