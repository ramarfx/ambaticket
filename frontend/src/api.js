const key = 'ambaticket.buyerId';

// Identitas default di localStorage, bisa ditimpa per tab lewat ?buyer= agar
// beberapa tab bisa menjadi pembeli berbeda untuk demo.
export const storedBuyerId = localStorage.getItem(key) ?? crypto.randomUUID();
localStorage.setItem(key, storedBuyerId);

export const buyerId =
  new URLSearchParams(window.location.search).get('buyer') ?? storedBuyerId;

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-buyer-id': buyerId,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message;
    throw new Error(message ?? `Permintaan gagal (${response.status}).`);
  }
  return body;
}

const post = (path, input) =>
  request(path, {
    method: 'POST',
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });

export const getEvents = () => request('/events');
export const getEvent = (id) => request(`/events/${id}`);
export const createEvent = (input) => post('/events', input);
export const getOrders = () => request('/orders');
export const createOrder = (input) => post('/orders', input);
export const cancelOrder = (id) => post(`/orders/${id}/cancel`);
export const payOrder = (id) => post(`/orders/${id}/pay`);
export const getTickets = () => request('/tickets');

// Helper HMAC SHA-256 menggunakan Web Crypto API standar di browser
async function signHmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const sendPaymentWebhook = async (payload, customSignature) => {
  const secret =
    import.meta.env.VITE_PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const bodyString = JSON.stringify(payload);
  const signature =
    customSignature ?? (await signHmacSha256(secret, bodyString));

  const response = await fetch('/api/webhooks/payments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment-signature': signature,
    },
    body: bodyString,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message;
    throw new Error(message ?? `Webhook ditolak (${response.status}).`);
  }
  return { response, body, payload, signature };
};
