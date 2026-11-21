import { useEffect, useState } from 'react';
import { buyerId, storedBuyerId } from './api.js';
import CreateEventPage from './pages/CreateEventPage.jsx';
import EventDetailPage from './pages/EventDetailPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import OrdersPage from './pages/OrdersPage.jsx';
import TicketsPage from './pages/TicketsPage.jsx';
import { PageHeader, btnGhost, field } from './ui.jsx';

const nav = [
  { href: '#/', label: 'Event' },
  { href: '#/orders', label: 'Pesanan saya' },
  { href: '#/tickets', label: 'Tiket saya' },
  { href: '#/events/new', label: 'Buat event' },
];

const demoBuyers = ['demo-1', 'demo-2', 'demo-3'];

function buyerOptions(current) {
  const options = [
    {
      id: storedBuyerId,
      label: `pembeli saya (${storedBuyerId.slice(0, 8)})`,
    },
    ...demoBuyers.map((id) => ({ id, label: id })),
  ];
  return options.some((option) => option.id === current)
    ? options
    : [{ id: current, label: `pembeli ${current.slice(0, 8)}` }, ...options];
}

// Reload halaman saat ganti pembeli, supaya api.js membaca ulang ?buyer=.
function switchBuyer(next) {
  const { pathname, hash } = window.location;
  window.location.href =
    next === storedBuyerId
      ? `${pathname}${hash}`
      : `${pathname}?buyer=${encodeURIComponent(next)}${hash}`;
}

// Router seadanya: cukup hash, tanpa dependensi tambahan.
function useRoute() {
  const [route, setRoute] = useState(
    () => window.location.hash.slice(1) || '/',
  );

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return route;
}

function isActive(href, route) {
  if (href === '#/') {
    return route === '/' || (route.startsWith('/events/') && route !== '/events/new');
  }
  return route === href.slice(1);
}

function NotFound() {
  return (
    <div className="space-y-6">
      <PageHeader title="Halaman tidak ditemukan" />
      <a href="#/" className={btnGhost}>
        Kembali ke daftar event
      </a>
    </div>
  );
}

export default function App() {
  const route = useRoute();

  const detail = route.match(/^\/events\/([^/]+)$/);

  let page = <NotFound />;
  if (route === '/') page = <EventsPage />;
  else if (route === '/events/new') page = <CreateEventPage />;
  else if (detail) page = <EventDetailPage id={detail[1]} />;
  else if (route === '/orders') page = <OrdersPage />;
  else if (route === '/tickets') page = <TicketsPage />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-rule bg-card lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col gap-3 p-4 lg:gap-6 lg:p-5">
          <a href="#/" className="text-lg font-semibold tracking-tight">
            AmbaTicket
          </a>
          <nav
            aria-label="Navigasi utama"
            className="flex gap-1 overflow-x-auto lg:flex-col"
          >
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href, route) ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border px-3 text-sm transition-colors ${
                  isActive(item.href, route)
                    ? 'border-rule bg-paper font-medium text-ink'
                    : 'border-transparent text-ink-muted hover:border-rule hover:text-ink'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="lg:mt-auto">
            <label htmlFor="buyer" className="text-xs text-ink-muted">
              Pembeli
            </label>
            <select
              id="buyer"
              className={`${field} mt-1`}
              value={buyerId}
              onChange={(event) => switchBuyer(event.target.value)}
            >
              {buyerOptions(buyerId).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {page}
        </main>
        <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-ink-muted sm:px-6 lg:px-10">
          Pembayaran disimulasikan lewat endpoint /pay. Tidak ada autentikasi,
          pembeli dikenali dari id di localStorage atau parameter ?buyer=.
        </footer>
      </div>
    </div>
  );
}
