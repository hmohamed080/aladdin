-- Admin-controlled limits, their audit trail, replay claims, alert state and the notification outbox.
-- Additive and idempotent (IF NOT EXISTS): safe on a database whose 0001 was applied by hand (the Production D1 has no d1_migrations
-- table), where `wrangler d1 migrations apply` records 0001 as a no-op and then applies this file. It contains NO configuration values:
-- the settings row is created only by an explicit, audited Super Admin action, so an unconfigured Worker sends nothing.

-- The authoritative runtime limits. One row. The database itself refuses an invalid combination.
CREATE TABLE IF NOT EXISTS otp_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  daily_limit INTEGER NOT NULL CHECK (daily_limit >= 1),
  hard_ceiling INTEGER NOT NULL CHECK (hard_ceiling >= 1 AND hard_ceiling <= 1000000),
  warn_percent INTEGER NOT NULL CHECK (warn_percent >= 1 AND warn_percent <= 99),
  critical_percent INTEGER NOT NULL CHECK (critical_percent >= 2 AND critical_percent <= 100),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 8 AND 64),
  CHECK (daily_limit <= hard_ceiling),
  CHECK (warn_percent < critical_percent)
);

-- Authoritative audit of every change: who (the verified Supabase user id), old values, new values, reason, time.
CREATE TABLE IF NOT EXISTS otp_settings_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 8 AND 64),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 8 AND 64),
  kind TEXT NOT NULL CHECK (kind IN ('initialize', 'update')),
  old_daily_limit INTEGER,
  new_daily_limit INTEGER NOT NULL,
  old_hard_ceiling INTEGER,
  new_hard_ceiling INTEGER NOT NULL,
  old_warn_percent INTEGER,
  new_warn_percent INTEGER NOT NULL,
  old_critical_percent INTEGER,
  new_critical_percent INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500)
);

-- One-time admin request ids (a hash only), so a captured signed request can never be applied twice.
CREATE TABLE IF NOT EXISTS otp_admin_requests (
  request_hash TEXT PRIMARY KEY NOT NULL CHECK (length(request_hash) = 64),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_admin_requests_created_at ON otp_admin_requests(created_at);

-- Alert levels so each threshold crossing raises ONE event and re-arms only after usage falls back.
CREATE TABLE IF NOT EXISTS otp_alert_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  budget_level INTEGER NOT NULL DEFAULT 0 CHECK (budget_level BETWEEN 0 AND 3),
  failure_alert INTEGER NOT NULL DEFAULT 0 CHECK (failure_alert IN (0, 1)),
  episode INTEGER NOT NULL DEFAULT 0 CHECK (episode >= 0),
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO otp_alert_state (id) VALUES (1);

-- Events waiting to reach the app's notification endpoint. Kept until delivered, retried with backoff; statistics only.
CREATE TABLE IF NOT EXISTS otp_notification_outbox (
  event_key TEXT PRIMARY KEY NOT NULL CHECK (length(event_key) BETWEEN 3 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('budget_warning', 'budget_critical', 'budget_exhausted', 'failure_rate')),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(payload) <= 1024),
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_status INTEGER
);
CREATE INDEX IF NOT EXISTS otp_notification_outbox_pending ON otp_notification_outbox(delivered_at, next_attempt_at);
