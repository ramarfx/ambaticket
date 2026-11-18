-- Isi counter penjaga dari pesanan yang sudah ada. Counter ini hanya dipakai
-- untuk menerima atau menolak pesanan, sedangkan laporan stok tetap dihitung
-- dari tabel orders, jadi nilai awal harus sama dengan definisi "pesanan hidup".
UPDATE "ticket_types" AS tt SET
  sold_units = COALESCE((
    SELECT SUM(o.quantity) FROM "orders" o
    WHERE o.ticket_type_id = tt.id AND o.status = 'paid'
  ), 0),
  held_units = COALESCE((
    SELECT SUM(o.quantity) FROM "orders" o
    WHERE o.ticket_type_id = tt.id AND o.status = 'pending' AND o.expires_at > now()
  ), 0);
--> statement-breakpoint
INSERT INTO "buyer_quota" ("event_id", "buyer_id", "live_units")
SELECT o.event_id, o.buyer_id, SUM(o.quantity)::smallint
FROM "orders" o
WHERE o.status = 'paid' OR (o.status = 'pending' AND o.expires_at > now())
GROUP BY o.event_id, o.buyer_id
ON CONFLICT DO NOTHING;
