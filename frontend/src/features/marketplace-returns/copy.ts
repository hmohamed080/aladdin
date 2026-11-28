import type { EscalationReason, ReturnAction, ReturnDocument, ReturnStatus } from "./contract";

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
  noteInternal: { ar: "ملاحظة داخلية (لا تظهر للمشتري ولا للمعرض)", en: "Internal note (never shown to the buyer or the showroom)" },
  required: { ar: "مطلوب", en: "required" },
  order: { ar: "الطلب", en: "Order" },
  buyer: { ar: "المشتري", en: "Buyer" },
  showroom: { ar: "المعرض", en: "Showroom" },
  sentAt: { ar: "تاريخ الطلب", en: "Requested on" },
  buyerNote: { ar: "ملاحظة المشتري", en: "Buyer's note" },
  decisionBy: { ar: "رد", en: "Reply of" },
  actionNeeded: { ar: "مطلوب إجراء", en: "Action needed" },
  tracking: { ar: "رقم التتبع (اختياري)", en: "Tracking number (optional)" },
  trackingNumber: { ar: "رقم التتبع", en: "Tracking number" },
  trackingHint: { ar: "من 3 إلى 64: حروف إنجليزية أو أرقام أو . _ / - بدون مسافات.", en: "3 to 64 English letters, digits or . _ / - with no spaces." },
  trackingInvalid: { ar: "رقم التتبع غير صالح: استخدم حروفًا إنجليزية أو أرقامًا أو . _ / - بدون مسافات، أو اتركه فارغًا.", en: "That tracking number is not valid: use English letters, digits or . _ / - with no spaces, or leave it empty." },
  adminNoteRequired: { ar: "اكتب الملاحظة الداخلية (3 أحرف على الأقل) قبل القرار.", en: "Write the internal note (at least 3 characters) before deciding." },
  rejectTitle: { ar: "سبب الرفض (مطلوب)", en: "Reason for rejecting (required)" },
  rejectIntro: { ar: "يظهر السبب للمشتري. اختر سببًا جاهزًا أو اكتب سببك.", en: "The buyer sees the reason. Pick a ready one or write your own." },
  rejectConfirm: { ar: "تأكيد الرفض", en: "Confirm rejection" },
  back: { ar: "رجوع", en: "Back" },
  adminApproveAsk: { ar: "تأكيد الموافقة على الإرجاع؟ القرار لا يمكن التراجع عنه، ويصل إلى المشتري والمعرض.", en: "Approve this return? The decision cannot be undone, and the buyer and the showroom are told." },
  adminRejectAsk: { ar: "تأكيد رفض الإرجاع؟ القرار لا يمكن التراجع عنه، ويصل إلى المشتري والمعرض.", en: "Reject this return? The decision cannot be undone, and the buyer and the showroom are told." },
  adminApproveConfirm: { ar: "تأكيد الموافقة", en: "Confirm approval" },
  partialAmount: { ar: "المبلغ المقترح رده (جنيه)", en: "Proposed refund (EGP)" },
  partialHint: { ar: "أكبر من صفر وأقل من قيمة المنتجات المرتجعة ({max}).", en: "More than zero and less than the value of the returned items ({max})." },
  partialInvalid: { ar: "اكتب مبلغًا أكبر من صفر وأقل من {max}.", en: "Enter an amount above zero and below {max}." },
  partialNote: { ar: "رسالة للمشتري (اختياري)", en: "Message to the buyer (optional)" },
  partialSend: { ar: "إرسال الاقتراح", en: "Send the proposal" },
  noteTooShort: { ar: "الرسالة 3 أحرف على الأقل، أو اتركها فارغة.", en: "Write at least 3 characters, or leave the message empty." },
  partialProposed: { ar: "استرداد جزئي مقترح", en: "Proposed partial refund" },
  complaintReason: { ar: "سبب الشكوى", en: "Complaint" },
  complaintHint: { ar: "تراجعها إدارة المنصة.", en: "The platform team reviews it." },
  complaintRequired: { ar: "اكتب سبب الشكوى (3 أحرف على الأقل).", en: "Write the complaint (at least 3 characters)." },
  complaintSend: { ar: "إرسال الشكوى", en: "Send the complaint" },
  refundToPay: { ar: "المبلغ المطلوب رده", en: "Amount to pay back" },
  refundRecorded: { ar: "الاسترداد المسجّل", en: "Recorded refund" },
  referenceNote: { ar: "رقم العملية أو ملاحظة (اختياري، يظهر للمشتري)", en: "Reference or note (optional, the buyer sees it)" },
  exchangeNote: { ar: "ملاحظة التسليم (اختياري)", en: "Handover note (optional)" },
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
    photosHint: "صور JPG أو PNG أو WebP توضّح المشكلة.", addPhoto: "إضافة صورة", uploading: "جارٍ رفع الصورة…", attach: (n: number) => `إرفاق الصورة ${n}`, view: "عرض", remove: "حذف", removeNth: (n: number) => `حذف الصورة ${n}`,
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
    photosHint: "JPG, PNG or WebP photos that show the problem.", addPhoto: "Add a photo", uploading: "Uploading the photo…", attach: (n: number) => `Attach photo ${n}`, view: "View", remove: "Delete", removeNth: (n: number) => `Delete photo ${n}`,
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

export const RETURNABILITY_COPY = {
  ar: {
    title: "الإرجاع", label: "مصنوع حسب الطلب: غير قابل للإرجاع", saved: "تم الحفظ.",
    hint: "يظهر للمشتري في صفحة المنتج وقبل الدفع. يبقى له حق المطالبة إذا وصل المنتج بعيب. يسري على الطلبات الجديدة.",
    notice: "منتج مصنوع حسب الطلب: لا يُرجع بعد الاستلام إلا إذا كان به عيب.",
  },
  en: {
    title: "Returns", label: "Made to order: cannot be returned", saved: "Saved.",
    hint: "Buyers see this on the product page and before paying. A defective item can still be claimed. Applies to new orders.",
    notice: "Made to order: it cannot be returned after delivery unless it is defective.",
  },
} as const;

const RETURN_ERRORS: Record<string, L> = {
  reason_required: { ar: "اكتب السبب (من 3 أحرف على الأقل).", en: "Write the reason (at least 3 characters)." },
  invalid_payload: { ar: "البيانات المدخلة غير صالحة. راجع الخانات ثم أعد المحاولة.", en: "Something entered is not valid. Check the fields and try again." },
  invalid_transition: { ar: "تغيّرت حالة الطلب. حدّث الصفحة لرؤية الحالة الحالية.", en: "The request has moved on. Reload the page to see where it stands." },
  preset_invalid: { ar: "لم يعد هذا السبب متاحًا. اختر سببًا آخر.", en: "That reason is no longer available. Pick another one." },
  insufficient_stock: { ar: "لا يوجد مخزون كافٍ لتسليم البديل.", en: "There is not enough stock for the replacement." },
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

export const ESCALATION_LABEL: Record<EscalationReason, L> = {
  complaint: { ar: "بسبب شكوى", en: "Because of a complaint" },
  seller_silent: { ar: "لأن المعرض لم يتصرف في المهلة", en: "The showroom did not act in time" },
  refund_unconfirmed: { ar: "لأن المشتري لم يؤكد استلام المبلغ", en: "The buyer did not confirm the refund" },
};

export const REFUND_METHOD_LABEL: Record<string, L> = {
  cod: { ar: "نقدًا", en: "Cash" },
  instapay_full: { ar: "إنستاباي", en: "InstaPay" },
  instapay_deposit: { ar: "إنستاباي", en: "InstaPay" },
  instapay: { ar: "إنستاباي", en: "InstaPay" },
};

/** One sentence saying where the request stands for this reader: who acts next, by when, and for how much. */
export function returnStateText(
  doc: ReturnDocument,
  role: "buyer" | "seller" | "admin",
  locale: "ar" | "en",
  when: (iso: string) => string,
  money: (n: number) => string,
): string | null {
  const ar = locale === "ar";
  const ts = doc.timestamps;
  if (doc.in_admin_queue) {
    const why = doc.escalated_reason ? ` ${ESCALATION_LABEL[doc.escalated_reason][locale]}` : "";
    return ar ? `قيد مراجعة المنصة.${why}.` : `Under review by the platform team.${why}.`;
  }
  if (doc.status === "requested") {
    const by = when(ts.seller_due_at);
    if (role === "seller") return ar ? `ردّ قبل ${by}، وإلا يُحال الطلب لإدارة المنصة.` : `Reply before ${by}, or the request goes to the platform team.`;
    return ar ? `في انتظار رد المعرض قبل ${by}.` : `Waiting for the showroom to reply before ${by}.`;
  }
  if (doc.status === "approved") {
    if (role === "buyer") return ar ? "تمت الموافقة. أرسل المنتج للمعرض ثم اضغط «تم شحن المنتج»." : "Approved. Send the items to the showroom, then press “I shipped it”.";
    return ar ? "في انتظار وصول المنتج من المشتري." : "Waiting for the items from the buyer.";
  }
  if (doc.status === "in_transit") {
    if (role === "seller") return ar ? "المنتج في الطريق إليك. أكّد الاستلام عند وصوله." : "The items are on their way. Mark them received when they arrive.";
    return ar ? "المنتج في الطريق للمعرض." : "The items are on their way to the showroom.";
  }
  if (doc.status === "received") {
    if (doc.refund?.state === "sent") {
      const amount = money(Number(doc.refund.amount_egp));
      if (role === "buyer") return ar ? `سجّل المعرض رد ${amount}. إذا وصلك المبلغ اضغط «تأكيد استلام المبلغ».` : `The showroom recorded a refund of ${amount}. If it reached you, press “Confirm refund received”.`;
      return ar ? `سُجّل رد ${amount}. في انتظار تأكيد المشتري.` : `A refund of ${amount} is recorded. Waiting for the buyer to confirm it.`;
    }
    if (doc.remedy === "exchange") return ar ? "استلم المعرض المنتج. التالي: تسليم البديل." : "The showroom received the items. Next: hand over the replacement.";
    const amount = money(Number(doc.max_refund_egp));
    const by = ts.refund_due_at ? when(ts.refund_due_at) : "";
    if (role === "seller") return ar ? `رد ${amount} للمشتري قبل ${by} ثم سجّله هنا.` : `Pay ${amount} back to the buyer before ${by}, then record it here.`;
    return ar ? `استلم المعرض المنتج. موعد رد ${amount}: قبل ${by}.` : `The showroom received the items. ${amount} is due back before ${by}.`;
  }
  return null;
}

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
