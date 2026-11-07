-- Acceptance-only replay journal. No phone numbers, code values or payloads.
-- Must be installed in the isolated D1 database BEFORE enabling WhatsApp delivery.
CREATE TABLE IF NOT EXISTS whatsapp_hook_events (
  event_hash TEXT PRIMARY KEY NOT NULL CHECK(length(event_hash) = 64),
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved', 'accepted', 'failed'))
);
CREATE INDEX IF NOT EXISTS whatsapp_hook_events_created_at ON whatsapp_hook_events(created_at);
-- Operational retention after a reviewed TTL window, e.g. delete records older than
-- seven days through a separately authorized scheduled maintenance task.
