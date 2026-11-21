import { useApi } from '../hooks.js';
import { Empty, Notice, PageHeader, btnGhost } from '../ui.jsx';
import { getEvents } from '../api.js';
import { rupiah, tanggal } from '../format.js';

export default function EventsPage() {
  const { data: events, loading, error, reload } = useApi(getEvents, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Event"
        description="Pilih event, lalu pesan tiket yang tersedia."
        actions={
          <a href="#/events/new" className={btnGhost}>
            Buat event
          </a>
        }
      />

      {error ? (
        <Notice kind="error" retry={reload}>
          {error}
        </Notice>
      ) : null}

      {!events?.length ? (
        <Empty loading={loading} label="Belum ada event." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events?.map((event) => {
            const remaining = event.ticketTypes.reduce(
              (sum, type) => sum + type.remaining,
              0,
            );
            const cheapest = Math.min(
              ...event.ticketTypes.map((type) => type.priceIdr),
            );
            return (
              <li key={event.id}>
                <a
                  href={`#/events/${event.id}`}
                  className="flex h-full flex-col border border-rule bg-card p-5 transition-colors hover:border-ink"
                >
                  <h2 className="text-base font-semibold">{event.name}</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    {event.venue} ·{' '}
                    <time dateTime={event.startsAt}>
                      {tanggal.format(new Date(event.startsAt))}
                    </time>
                  </p>
                  <div className="mt-4 flex items-end justify-between gap-3 border-t border-dashed border-rule pt-3">
                    <p className="font-mono text-xs text-ink-muted">
                      mulai {rupiah.format(cheapest)}
                    </p>
                    <p
                      className={`font-mono text-xs ${
                        remaining > 0 ? 'text-ink' : 'text-stamp'
                      }`}
                    >
                      {remaining > 0 ? `sisa ${remaining} tiket` : 'Habis'}
                    </p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
