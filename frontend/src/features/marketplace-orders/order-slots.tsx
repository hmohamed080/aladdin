/**
 * Extension slots the order pages render for actions owned by later PRs. The order document's `actions` list decides
 * whether a slot is shown; the database re-checks on submit.
 *
 * PR 14 (payment complaints) replaces the body of `FileComplaintSlot` with its `FileComplaint` component
 * (features/marketplace-admin-complaints/file-complaint.tsx) once it is on main. Until then the slot renders nothing,
 * so PR 13 neither depends on PR 14 nor shows a control that has no backend yet.
 */
export function FileComplaintSlot({ orderId }: { orderId: string }) {
  void orderId;
  return null;
}
