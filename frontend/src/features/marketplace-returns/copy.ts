import type { ReturnAction, ReturnStatus } from "./contract";

type L = { ar: string; en: string };

export const RETURN_STATUS_LABEL: Record<ReturnStatus, L> = {
  requested: { ar: "قيد المراجعة", en: "Requested" },
  approved: { ar: "تمت الموافقة", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  in_transit: { ar: "في الطريق للمعرض", en: "On its way back" },
  received: { ar: "تم الاستلام", en: "Received" },
  refunded: { ar: "تم الاسترداد", en: "Refunded" },
  exchanged: { ar: "تم الاستبدال", en: "Exchanged" },
  closed: { ar: "مغلق", en: "Closed" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
};

export const RETURN_ACTION_LABEL: Record<ReturnAction, L> = {
  cancel: { ar: "إلغاء الطلب", en: "Cancel request" },
  mark_shipped: { ar: "تم شحن المنتج", en: "I shipped it" },
  confirm_refund: { ar: "تأكيد استلام المبلغ", en: "Confirm refund received" },
  file_complaint: { ar: "تقديم شكوى", en: "File a complaint" },
  approve: { ar: "موافقة", en: "Approve" },
  reject: { ar: "رفض", en: "Reject" },
  propose_partial: { ar: "اقتراح استرداد جزئي", en: "Propose partial refund" },
  receive: { ar: "تأكيد الاستلام", en: "Mark received" },
  record_refund: { ar: "تسجيل الاسترداد", en: "Record refund" },
  fulfil_exchange: { ar: "تم تسليم البديل", en: "Replacement handed over" },
  remind_seller: { ar: "تذكير المعرض", en: "Remind the showroom" },
};

export const RETURN_COPY = {
  buyerTitle: { ar: "طلبات الإرجاع", en: "My returns" },
  sellerTitle: { ar: "المرتجعات والاستبدال", en: "Returns and exchanges" },
  adminTitle: { ar: "قائمة مراجعة المرتجعات", en: "Returns review queue" },
  empty: { ar: "لا توجد طلبات.", en: "Nothing here yet." },
  note: { ar: "ملاحظة", en: "Note" },
  noteInternal: { ar: "ملاحظة داخلية (لا تظهر للمشتري ولا للمعرض)", en: "Internal note (never shown to the buyer or the showroom)" },
  amount: { ar: "المبلغ (جنيه)", en: "Amount (EGP)" },
  failed: { ar: "تعذر تنفيذ الإجراء.", en: "The action could not be completed." },
  events: { ar: "سجل الطلب", en: "Request history" },
} satisfies Record<string, L>;
