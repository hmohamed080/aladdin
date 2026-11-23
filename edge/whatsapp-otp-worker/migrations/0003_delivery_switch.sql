-- The Super Admin delivery switch and its audit trail. Additive and idempotent (IF NOT EXISTS), like 0002.
-- It contains NO row: the switch is created only by an explicit, grant-protected, audited Super Admin action, and a missing row means OFF,
-- so an unconfigured or freshly migrated Worker sends nothing.

-- The authoritative runtime switch. One row. enabled = 1 is necessary but not sufficient: the send path also requires the environment permit
-- (WHATSAPP_DELIVERY_ENABLED = "true" on the Worker) and a valid limits row.
CREATE TABLE IF NOT EXISTS otp_delivery_switch (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 8 AND 64)
);

-- Authoritative audit of every change: who (the verified Supabase user id), old value, new value, reason, time.
CREATE TABLE IF NOT EXISTS otp_delivery_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 8 AND 64),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 8 AND 64),
  old_enabled INTEGER CHECK (old_enabled IS NULL OR old_enabled IN (0, 1)),
  new_enabled INTEGER NOT NULL CHECK (new_enabled IN (0, 1)),
  new_version INTEGER NOT NULL CHECK (new_version >= 1),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500)
);

-- The signed attestation of the Aladdin database: which delivery state is AUTHORIZED, as of when. Written only by the scheduled attestation
-- (attest.ts) after it verified the app's HMAC. The send path counts the switch as ON only when this row says ON at the switch's version, is
-- correctly signed (the secret is in the Secrets Store, never in D1) and is younger than the TTL. A row here that was not produced by the app
-- cannot carry a valid signature, so forging the switch and its audit row is not enough to send.
CREATE TABLE IF NOT EXISTS otp_delivery_attestation (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  issued_at INTEGER NOT NULL,
  nonce TEXT NOT NULL CHECK (length(nonce) = 32),
  mac TEXT NOT NULL CHECK (length(mac) BETWEEN 40 AND 128)
);
