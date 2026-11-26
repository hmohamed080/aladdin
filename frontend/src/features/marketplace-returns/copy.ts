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
  sellable: { ar: "سليم ويرجع للمخزون", en: "In good condition: return to stock" },
  sellableHint: { ar: "حدّد القطع السليمة فقط. غير المحدد لا يعود للبيع.", en: "Tick only the items in good condition. Unticked items do not go back on sale." },
  partialAppeal: { ar: "شكوى على استرداد جزئي: «قبول» يمنح القيمة كاملة، و«رفض» يُبقي المبلغ المقترح.", en: "Complaint about a partial refund: approving grants the full value, rejecting keeps the proposed amount." },
  photos: { ar: "صور المشكلة", en: "Photos" },
  photo: { ar: "صورة", en: "Photo" },
  failed: { ar: "تعذر تنفيذ الإجراء.", en: "The action could not be completed." },
  events: { ar: "سجل الطلب", en: "Request history" },
} satisfies Record<string, L>;

export const RETURN_REQUEST_COPY = {
  ar: {
    title: "طلب إرجاع أو استبدال", kind: "نوع الطلب", kindReturn: "إرجاع واسترداد المبلغ", kindExchange: "استبدال بنفس المنتج أو بنفس السعر",
    reason: "السبب", shippingSeller: "شحن الإرجاع على المعرض", shippingBuyer: "شحن الإرجاع عليك", photoRequired: "يحتاج صورة",
    generalClosed: "انتهت مدة الإرجاع العادية لهذا الطلب. الأسباب المعروضة فقط هي المتاحة.",
    items: "المنتجات والكمية", nonReturnable: "مصنوع حسب الطلب: يُقبل للعيوب فقط.", upTo: (n: number) => `حتى ${n}`,
    note: "ملاحظة للمعرض (اختياري)", photos: (n: number, max: number) => `الصور (${n} من ${max})`,
    photosHint: "صور JPG أو PNG أو WebP توضّح المشكلة.", addPhoto: "إضافة صورة", uploading: "جارٍ رفع الصورة…", attach: (n: number) => `إرفاق الصورة ${n}`, view: "عرض",
    send: "إرسال الطلب", sending: "جارٍ الإرسال…", back: "العودة إلى الطلب",
    unavailable: "لا يمكن فتح طلب إرجاع لهذا الطلب. قد تكون المدة انتهت أو لم يعد فيه ما يُرجع.",
    problem: {
      no_lines: "اختر كمية منتج واحد على الأقل.", no_reason: "اختر السبب.", evidence_required: "هذا السبب يحتاج صورة واحدة على الأقل.",
      quantity: "الكمية أكبر من المتاح للإرجاع.", not_returnable: "منتج مصنوع حسب الطلب لا يُقبل لهذا السبب.",
    },
  },
  en: {
    title: "Return or exchange", kind: "What you want", kindReturn: "Return and get a refund", kindExchange: "Exchange for the same product or the same price",
    reason: "Reason", shippingSeller: "The showroom pays the return shipping", shippingBuyer: "You pay the return shipping", photoRequired: "Photo needed",
    generalClosed: "The regular return period of this order has ended. Only the reasons shown are still open.",
    items: "Products and quantity", nonReturnable: "Made to order: accepted for defects only.", upTo: (n: number) => `Up to ${n}`,
    note: "Note for the showroom (optional)", photos: (n: number, max: number) => `Photos (${n} of ${max})`,
    photosHint: "JPG, PNG or WebP photos that show the problem.", addPhoto: "Add a photo", uploading: "Uploading the photo…", attach: (n: number) => `Attach photo ${n}`, view: "View",
    send: "Send the request", sending: "Sending…", back: "Back to the order",
    unavailable: "A return cannot be opened for this order. The period may have ended, or nothing is left to return.",
    problem: {
      no_lines: "Choose a quantity of at least one product.", no_reason: "Choose a reason.", evidence_required: "This reason needs at least one photo.",
      quantity: "The quantity is more than what can be returned.", not_returnable: "A made-to-order product is not accepted for this reason.",
    },
  },
} as const;

export const RETURN_POLICY_COPY = {
  ar: {
    title: "سياسة الإرجاع", subtitle: "عدد الأيام التي يمكن للمشتري خلالها طلب الإرجاع بعد الاستلام.",
    general: "الإرجاع العادي (بالأيام)", defect: "العيوب (بالأيام)", minimum: (n: number) => `الحد الأدنى ${n} يومًا. يمكنك عرض مدة أطول.`,
    save: "حفظ", saving: "جارٍ الحفظ…", saved: "تم حفظ سياسة الإرجاع.",
  },
  en: {
    title: "Return policy", subtitle: "How many days after delivery a buyer may ask for a return.",
    general: "Regular returns (days)", defect: "Defects (days)", minimum: (n: number) => `At least ${n} days. You may offer longer.`,
    save: "Save", saving: "Saving…", saved: "The return policy was saved.",
  },
} as const;

const RETURN_ERRORS: Record<string, L> = {
  auth_required: { ar: "سجّل الدخول ثم أعد المحاولة.", en: "Sign in and try again." },
  account_inactive: { ar: "حسابك غير مفعّل.", en: "Your account is not active." },
  not_permitted: { ar: "ليست لديك صلاحية لهذا الإجراء.", en: "You are not allowed to do this." },
  not_found: { ar: "لم يتم العثور على الطلب.", en: "Not found." },
  return_window_closed: { ar: "انتهت مدة الإرجاع لهذا السبب.", en: "The return period for this reason has ended." },
  return_not_eligible: { ar: "هذا الطلب أو المنتج لا يقبل الإرجاع.", en: "This order or product cannot be returned." },
  evidence_required: { ar: "أضف صورة توضّح المشكلة.", en: "Add a photo that shows the problem." },
  return_exists: { ar: "يوجد طلب إرجاع مفتوح لهذا الطلب.", en: "This order already has an open return." },
  quantity_exceeds_order: { ar: "الكمية أكبر من المتاح للإرجاع.", en: "The quantity is more than what can be returned." },
  image_type_invalid: { ar: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.", en: "Unsupported image type. Use JPG, PNG or WebP." },
  file_too_large: { ar: "الصورة أكبر من الحد المسموح.", en: "The image is too large." },
  too_many_images: { ar: "وصلت إلى الحد الأقصى للصور (6).", en: "You reached the photo limit (6)." },
  upload_rate_limited: { ar: "محاولات رفع كثيرة. حاول بعد قليل.", en: "Too many uploads. Try again later." },
  upload_not_found: { ar: "لم يكتمل رفع الصورة. أعد رفعها.", en: "The photo did not finish uploading. Add it again." },
  upload_failed: { ar: "تعذر رفع الصورة. أعد المحاولة.", en: "The photo could not be uploaded. Try again." },
  image_content_invalid: { ar: "الملف ليس صورة سليمة.", en: "The file is not a valid image." },
};

export function returnErrorText(locale: "ar" | "en", code: string): string {
  return RETURN_ERRORS[code]?.[locale] ?? RETURN_COPY.failed[locale];
}

/** Words of the request history: who did what. An unknown name from a newer database is shown as it is. */
export const RETURN_ROLE_LABEL: Record<string, L> = {
  buyer: { ar: "المشتري", en: "Buyer" },
  seller: { ar: "المعرض", en: "Showroom" },
  admin: { ar: "إدارة المنصة", en: "Platform admin" },
  system: { ar: "النظام", en: "System" },
};

export const RETURN_EVENT_LABEL: Record<string, L> = {
  requested: { ar: "أُرسل الطلب", en: "Request sent" },
  approved: { ar: "تمت الموافقة", en: "Approved" },
  rejected: { ar: "تم الرفض", en: "Rejected" },
  cancelled: { ar: "أُلغي الطلب", en: "Cancelled" },
  shipped: { ar: "شُحن المنتج", en: "Shipped back" },
  in_transit: { ar: "في الطريق للمعرض", en: "On its way back" },
  received: { ar: "استلم المعرض المنتج", en: "Received" },
  refund_sent: { ar: "سُجّل رد المبلغ", en: "Refund recorded" },
  refund_confirmed: { ar: "تأكد استلام المبلغ", en: "Refund confirmed" },
  refunded: { ar: "تم الاسترداد", en: "Refunded" },
  exchanged: { ar: "تم الاستبدال", en: "Exchanged" },
  complaint_filed: { ar: "قُدمت شكوى", en: "Complaint filed" },
  escalated: { ar: "أُحيل الطلب لإدارة المنصة", en: "Sent to the platform team" },
  admin_reminded: { ar: "ذكّرت الإدارة المعرض", en: "The showroom was reminded" },
};
