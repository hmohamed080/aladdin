-- Exact application creator/schema only; no current-object or managed defaults change.
-- Implicit global PUBLIC EXECUTE remains: every sensitive function must explicitly
-- revoke PUBLIC and unintended API roles, then grant intended roles atomically.
-- Proposed hosted execution requires separate approval plus the permission gate.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
