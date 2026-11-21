import { useState } from 'react';
import {
  cancelOrder,
  getEvents,
  getOrders,
  sendPaymentWebhook,
} from '../api.js';
import { rupiah, statusClass, statusText, tanggal } from '../format.js';
import { useAction, useApi } from '../hooks.js';
import { Empty, Notice, PageHeader, btnGhost, btnPrimary } from '../ui.jsx';

export default function PaymentSimulatorPage({ orderId }) {
  const { data, loading, error, reload } = useApi(async () => {
    const [orders, events] = await Promise.all([getOrders(), getEvents()]);
    const order = orders.find((o) => o.id === orderId);
    return { order, events };
  }, [orderId]);

  const { busy, error: actionError, notice, run } = useAction();
  const [webhookLog, setWebhookLog] = useState(null);

  const order = data?.order;
  const event = data?.events?.find((e) => e.id === order?.eventId);
  const type = event?.ticketTypes?.find((t) => t.id === order?.ticketTypeId);

  const simulateSuccess = async () => {
    if (!order) return;
    await run(
      'pay-success',
      async () => {
        const payload = {
          eventId: `sim-${Date.now()}`,
          orderId: order.id,
          type: 'payment.succeeded',
          amountIdr: order.totalIdr,
        };
        const result = await sendPaymentWebhook(payload);
        setWebhookLog({
          status: 200,
          type: 'success',
          payload,
          signature: result.signature,
          result: result.body,
        });
        await reload();
      },
      'Webhook pembayaran berhasil dikirim dan diproses.',
    );
  };

  const simulateFailCancel = async () => {
    if (!order) return;
    await run(
      'pay-cancel',
      async () => {
        await cancelOrder(order.id);
        setWebhookLog({
          status: 200,
          type: 'cancelled',
          note: 'Pembeli membatalkan transaksi / transaksi kedaluwarsa di payment gateway.',
        });
        await reload();
      },
      'Pesanan dibatalkan (simulasi transaksi gagal).',
    );
  };

  const simulateBadSignature = async () => {
    if (!order) return;
    await run(
      'pay-bad-sig',
      async () => {
        const payload = {
          eventId: `sim-bad-${Date.now()}`,
          orderId: order.id,
          type: 'payment.succeeded',
          amountIdr: order.totalIdr,
        };
        try {
          await sendPaymentWebhook(payload, 'invalid-signature-hex-12345');
        } catch (err) {
          setWebhookLog({
            status: 401,
            type: 'invalid_signature',
            payload,
            signature: 'invalid-signature-hex-12345',
            error: err.message,
          });
          return;
        }
        throw new Error('Seharusnya webhook ditolak signature tidak valid.');
      },
      'Simulasi webhook dengan signature palsu berhasil ditolak backend.',
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulasi Payment Gateway"
        description="Simulator penyedia pembayaran eksternal untuk mengirim HTTP POST webhook ke AmbaTicket."
        actions={
          <a href="#/orders" className={btnGhost}>
            Kembali ke pesanan
          </a>
        }
      />

      {error || actionError ? (
        <Notice kind="error" retry={reload}>
          {error ?? actionError}
        </Notice>
      ) : null}

      {notice ? <Notice>{notice}</Notice> : null}

      {!order && !loading ? (
        <Empty label="Pesanan tidak ditemukan atau bukan milik akun ini." />
      ) : null}

      {order ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Ringkasan Pesanan */}
          <section className="space-y-4 border border-rule bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">
              Tagihan Pesanan
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Order ID</span>
                <span className="font-mono text-xs">{order.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Event</span>
                <span className="font-medium">{event?.name ?? '-'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Tipe Tiket</span>
                <span>{type?.name ?? '-'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Jumlah</span>
                <span className="font-mono">{order.quantity} tiket</span>
              </div>
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Total Bayar</span>
                <span className="font-mono font-semibold text-ink">
                  {rupiah.format(order.totalIdr)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-rule">
                <span className="text-ink-muted">Batas Waktu</span>
                <span className="font-mono text-xs">
                  {tanggal.format(new Date(order.expiresAt))}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-ink-muted">Status Pesanan</span>
                <span
                  className={`font-mono text-xs ${statusClass[order.status] ?? 'text-ink'}`}
                >
                  {statusText[order.status] ?? order.status}
                </span>
              </div>
            </div>

            {order.status === 'pending' ? (
              <div className="pt-4 border-t border-rule space-y-3">
                <p className="text-xs text-ink-muted">
                  Pilih skenario webhook dari payment gateway:
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!!busy}
                    onClick={simulateSuccess}
                  >
                    {busy === 'pay-success'
                      ? 'Mengirim Webhook...'
                      : 'Simulasikan Pembayaran Berhasil (Webhook 200)'}
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={!!busy}
                    onClick={simulateFailCancel}
                  >
                    {busy === 'pay-cancel'
                      ? 'Memproses...'
                      : 'Simulasikan Pembayaran Dibatalkan / Gagal'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center border border-dashed border-red-500/50 px-4 text-xs font-mono text-red-600 hover:bg-red-500/10 transition-colors"
                    disabled={!!busy}
                    onClick={simulateBadSignature}
                  >
                    {busy === 'pay-bad-sig'
                      ? 'Mengirim...'
                      : 'Tes Webhook Palsu (Signature Ditolak 401)'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-4 border-t border-rule">
                <p className="text-xs text-ink-muted">
                  Pesanan sudah berstatus{' '}
                  <strong>{statusText[order.status] ?? order.status}</strong>.
                </p>
                {order.status === 'paid' ? (
                  <a
                    href="#/tickets"
                    className={`${btnPrimary} mt-3 inline-block text-center`}
                  >
                    Lihat tiket terbit
                  </a>
                ) : null}
              </div>
            )}
          </section>

          {/* Webhook Inspector */}
          <section className="space-y-4 border border-rule bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">
              Log Webhook Inspector
            </h2>
            <p className="text-xs text-ink-muted">
              Menampilkan payload JSON dan header signature HMAC SHA-256 yang
              dikirimkan ke <code>POST /webhooks/payments</code>.
            </p>

            {webhookLog ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-ink-muted">Status Response:</span>
                  <span
                    className={`px-1.5 py-0.5 font-bold ${
                      webhookLog.status === 200
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-red-500/10 text-red-600'
                    }`}
                  >
                    HTTP {webhookLog.status}
                  </span>
                </div>

                {webhookLog.signature ? (
                  <div>
                    <p className="text-xs text-ink-muted">
                      x-payment-signature:
                    </p>
                    <pre className="mt-1 overflow-x-auto border border-rule bg-paper p-2 font-mono text-xs text-ink break-all">
                      {webhookLog.signature}
                    </pre>
                  </div>
                ) : null}

                {webhookLog.payload ? (
                  <div>
                    <p className="text-xs text-ink-muted">Request Payload:</p>
                    <pre className="mt-1 overflow-x-auto border border-rule bg-paper p-2 font-mono text-xs text-ink">
                      {JSON.stringify(webhookLog.payload, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {webhookLog.result ? (
                  <div>
                    <p className="text-xs text-ink-muted">Backend Result:</p>
                    <pre className="mt-1 overflow-x-auto border border-rule bg-paper p-2 font-mono text-xs text-ink">
                      {JSON.stringify(webhookLog.result, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {webhookLog.error ? (
                  <p className="font-mono text-xs text-red-600">
                    Error: {webhookLog.error}
                  </p>
                ) : null}

                {webhookLog.note ? (
                  <p className="text-xs text-ink-muted">{webhookLog.note}</p>
                ) : null}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-ink-muted border border-dashed border-rule">
                Klik salah satu aksi di samping untuk melihat webhook dikirim.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
