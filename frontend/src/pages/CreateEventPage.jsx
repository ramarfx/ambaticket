import { useState } from 'react';
import { createEvent } from '../api.js';
import { useAction } from '../hooks.js';
import { Notice, PageHeader, btnGhost, btnPrimary, field } from '../ui.jsx';

const kosong = {
  name: '',
  venue: '',
  startsAt: '',
  typeName: 'Reguler',
  priceIdr: '50000',
  quota: '20',
};

export default function CreateEventPage() {
  const [form, setForm] = useState(kosong);
  const { busy, error, run } = useAction();

  const update = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const created = await run(
      'create',
      () =>
        createEvent({
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
        }),
      'Event dibuat.',
    );
    if (created) window.location.hash = `#/events/${created.id}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buat event"
        description="Satu tipe tiket per event, tipe tambahan bisa dibuat lewat API."
        actions={
          <a href="#/" className={btnGhost}>
            Semua event
          </a>
        }
      />

      {error ? <Notice kind="error">{error}</Notice> : null}

      <form className="border border-rule bg-card p-5" onSubmit={submit}>
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
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan event'}
          </button>
          <a href="#/" className={btnGhost}>
            Batal
          </a>
        </div>
      </form>
    </div>
  );
}
