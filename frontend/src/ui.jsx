export const btn =
  'inline-flex min-h-11 items-center justify-center border px-4 text-sm font-medium transition-colors';

export const btnPrimary = `${btn} border-stamp bg-stamp text-paper hover:border-stamp-dark hover:bg-stamp-dark`;

export const btnGhost = `${btn} border-rule bg-transparent text-ink hover:border-ink`;

export const field = 'min-h-11 w-full border border-rule bg-paper px-3 text-sm';

export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}

export function Notice({ kind = 'info', retry, children }) {
  const error = kind === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-sm ${
        error
          ? 'border-stamp bg-stamp/5 text-stamp'
          : 'border-rule bg-card text-ink'
      }`}
    >
      <p>{children}</p>
      {retry ? (
        <button type="button" className={btnGhost} onClick={() => void retry()}>
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ loading, label }) {
  return (
    <p className="text-sm text-ink-muted">
      {loading ? 'Memuat data...' : label}
    </p>
  );
}
