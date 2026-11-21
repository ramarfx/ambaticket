const key = 'ambaticket.buyerId';

// Identitas default di localStorage, bisa ditimpa per tab lewat ?buyer= agar
// beberapa tab bisa menjadi pembeli berbeda untuk demo.
export const storedBuyerId =
  localStorage.getItem(key) ?? crypto.randomUUID();
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
