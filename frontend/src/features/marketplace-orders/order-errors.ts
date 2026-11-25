/**
 * `mp:` codes the order pages can show (PR 13). PR 12 owns the same vocabulary inside `contract.ts` for the
 * checkout; this set is what the order pages map to a sentence, so a page never shows raw database text.
 */
export const ORDER_PAGE_ERROR_CODES = new Set([
  "unexpected",
  "auth_required",
  "account_inactive",
  "not_permitted",
  "not_found",
  "invalid_payload",
  "invalid_action",
  "invalid_transition",
  "payment_not_confirmed",
  "order_not_cancellable",
  "payment_dispute_open",
  "reason_required",
  "preset_invalid",
  "legacy_order",
  "not_a_delivery_order",
  "image_type_invalid",
  "file_too_large",
  "upload_rate_limited",
  "upload_not_found",
  "upload_failed",
  "image_content_invalid",
  "marketplace_closed",
  "own_showroom",
  "tracking_invalid",
  "carrier_invalid",
]);

export function orderPageErrorCode(code: string): string {
  return ORDER_PAGE_ERROR_CODES.has(code) ? code : "unexpected";
}
