#!/usr/bin/env python3
"""Backup coverage for the request and verification namespaces (20261107090005).

Purchase-request photos and business-verification documents are R2 originals like any other. The eligibility rule
treats everything it cannot PROVE retired as required, and these two namespaces have no canonical table in that
rule, so every verified live R2 object of either namespace stays required - including a "deleted" one, and
including a verification document (compliance retention: it is never excluded from a backup)."""
import importlib.util, pathlib, sys

spec = importlib.util.spec_from_file_location("snapshot_objects", pathlib.Path(__file__).with_name("snapshot-objects.py"))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

U = "11111111-1111-4111-8111-111111111111"
O = "22222222-2222-4222-8222-222222222222"
ID = "33333333-3333-4333-8333-333333333333"


def loc(ns, key, storage_key):
    return {"namespace": ns, "object_key": key, "storage_key": storage_key, "provider": "r2", "cleaned_at": None,
            "verified_at": "2026-11-01", "owner_user_id": U}


rows = [
    loc("request", f"{U}/{ID}/{ID}.png", f"u/{U}/requests/{ID}/{ID}/original.png"),
    loc("request", f"{O}/{ID}/{ID}.png", f"o/{O}/requests/{ID}/{ID}/original.png"),
    loc("verification", f"{O}/{ID}.pdf", f"o/{O}/verification/{ID}/original.pdf"),
]
# Even if the database says the records are deleted, nothing here may be excluded.
data = {"public.purchase_request_images": [{"object_key": r["object_key"], "state": "deleted", "created_by": U, "id": ID} for r in rows],
        "public.business_verification_documents": [{"object_key": rows[2]["object_key"], "state": "deleted", "created_by": U, "id": ID}]}
result = list(mod.classify(rows, data))
assert len(result) == 3, result
assert all(cls == "required" for _, cls in result), result
print("PASS  request photos and verification documents are always required in a media backup")
sys.exit(0)
