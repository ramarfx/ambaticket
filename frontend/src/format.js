export const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export const tanggal = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const statusText = {
  pending: 'Menunggu bayar',
  paid: 'Lunas',
  cancelled: 'Dibatalkan',
  expired: 'Kedaluwarsa',
};

export const statusClass = {
  pending: 'text-stamp',
  paid: 'text-ink',
  cancelled: 'text-ink-muted',
  expired: 'text-ink-muted',
};
