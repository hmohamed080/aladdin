import { FileComplaint } from "@/features/marketplace-admin-complaints/file-complaint";

/**
 * Extension slots the order pages render for actions owned by later PRs. The order document's `actions` list decides
 * whether a slot is shown; the database re-checks on submit.
 */
export function FileComplaintSlot({ orderId }: { orderId: string }) {
  return <FileComplaint orderId={orderId} />;
}
