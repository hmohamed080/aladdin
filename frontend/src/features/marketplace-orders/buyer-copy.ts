import type { Locale } from "@/features/marketplace/marketplace-types";
import type { OrderStatus, PaymentStatus } from "./contract";

/**
 * Buyer-facing copy of checkout and "My orders" (the public Marketplace pages keep their copy in
 * local objects, like live-copy.ts / marketplace-cart-copy.ts).
 */
type Copy = {
  home: string;
  marketplace: string;
  cart: string;
  checkoutTitle: string;
  checkoutSubtitle: string;
  signInTitle: string;
  signInText: string;
  signIn: string;
  signUp: string;
  backToCart: string;
  emptyCart: string;
  loading: string;
  quoteFailed: string;
  retry: string;
  contactTitle: string;
  name: string;
  phone: string;
  phoneHint: string;
  note: string;
  notePlaceholder: string;
  addressTitle: string;
  governorate: string;
  chooseGovernorate: string;
  area: string;
  chooseArea: string;
  address: string;
  addressPlaceholder: string;
  showroomTitle: (name: string) => string;
  receiving: string;
  delivery: string;
  deliveryFee: (fee: string) => string;
  deliveryNeedsArea: string;
  deliveryNotHere: string;
  pickup: string;
  pickupFree: string;
  pickupNotOffered: string;
  payment: string;
  cod: string;
  codDesc: string;
  instapay: string;
  instapayDesc: (percent: number) => string;
  gateway: string;
  soon: string;
  noPayment: string;
  products: string;
  deliveryLine: string;
  total: string;
  depositNow: (amount: string) => string;
  grandTotal: string;
  exclVat: string;
  place: string;
  placing: string;
  reservedNote: string;
  unavailableSkipped: (n: number) => string;
  problemName: string;
  problemPhone: string;
  problemAddress: string;
  problemChoice: (name: string) => string;
  placedTitle: string;
  placedText: string;
  placedInstapay: string;
  viewOrder: (number: string) => string;
  myOrders: string;
  ordersTitle: string;
  ordersSubtitle: string;
  ordersEmpty: string;
  continueShopping: string;
  pieces: (n: number) => string;
  orderTitle: (number: string) => string;
  placedOn: string;
  from: string;
  items: string;
  qty: string;
  pickupFrom: string;
  deliverTo: string;
  status: Record<OrderStatus, string>;
  paymentStatus: Record<PaymentStatus, string>;
  instapayTitle: string;
  instapaySend: (amount: string) => string;
  instapayTo: string;
  instapayName: string;
  uploadReceipt: string;
  uploading: string;
  receiptHint: string;
  receiptSent: string;
  receiptRejected: (note: string) => string;
  receipts: string;
  receiptStatus: Record<"submitted" | "accepted" | "rejected", string>;
  cancel: string;
  cancelReason: string;
  cancelConfirm: string;
  cancelled: string;
  cancelReasonLabel: string;
  history: string;
  error: Record<string, string>;
};

export const buyerCopy: Record<Locale, Copy> = {
  ar: {
    home: "الرئيسية",
    marketplace: "الماركت",
    cart: "السلة",
    checkoutTitle: "إتمام الطلب",
    checkoutSubtitle: "أدخل بياناتك واختر طريقة الاستلام والدفع لكل معرض.",
    signInTitle: "سجّل الدخول لإتمام الطلب",
    signInText: "سلتك محفوظة على هذا الجهاز. سجّل الدخول أو أنشئ حسابًا، وستعود إلى هذه الصفحة لإكمال الطلب.",
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    backToCart: "العودة إلى السلة",
    emptyCart: "سلتك فارغة.",
    loading: "جارٍ تحميل الأسعار…",
    quoteFailed: "تعذّر تحديث الأسعار الآن.",
    retry: "حاول مرة أخرى",
    contactTitle: "بيانات التواصل",
    name: "الاسم بالكامل",
    phone: "رقم الموبايل",
    phoneHint: "يتواصل معك المعرض عليه لتأكيد الطلب.",
    note: "ملاحظة للمعرض (اختياري)",
    notePlaceholder: "مثلًا: أنسب موعد للتوصيل",
    addressTitle: "عنوان التوصيل",
    governorate: "المحافظة",
    chooseGovernorate: "اختر المحافظة",
    area: "المنطقة",
    chooseArea: "اختر المنطقة",
    address: "العنوان بالتفصيل",
    addressPlaceholder: "الشارع، رقم العمارة، الدور، علامة مميزة",
    showroomTitle: (name) => `من ${name}`,
    receiving: "طريقة الاستلام",
    delivery: "توصيل",
    deliveryFee: (fee) => `مصاريف التوصيل ${fee}`,
    deliveryNeedsArea: "اختر المحافظة والمنطقة لمعرفة سعر التوصيل.",
    deliveryNotHere: "هذا المعرض لا يوصّل إلى هذه المنطقة.",
    pickup: "استلام من المعرض",
    pickupFree: "بدون مصاريف توصيل",
    pickupNotOffered: "هذا المعرض لا يوفّر الاستلام.",
    payment: "طريقة الدفع",
    cod: "الدفع عند الاستلام",
    codDesc: "ادفع المبلغ كاملًا عند الاستلام.",
    instapay: "عربون إنستاباي",
    instapayDesc: (p) => (p >= 100 ? "حوّل المبلغ كاملًا عبر إنستاباي وارفع صورة الإيصال." : `حوّل عربونًا بنسبة ${p}٪ عبر إنستاباي وارفع صورة الإيصال، والباقي عند الاستلام.`),
    gateway: "الدفع بالبطاقة عبر الإنترنت",
    soon: "قريبًا",
    noPayment: "لم يفعّل هذا المعرض أي طريقة دفع بعد، لذلك لا يمكنك الطلب منه الآن.",
    products: "المنتجات",
    deliveryLine: "التوصيل",
    total: "الإجمالي",
    depositNow: (a) => `ستحوّل الآن ${a}`,
    grandTotal: "إجمالي كل الطلبات",
    exclVat: "الأسعار غير شاملة ضريبة القيمة المضافة",
    place: "تأكيد الطلب",
    placing: "جارٍ إرسال الطلب…",
    reservedNote: "تُحجز الكميات لك حتى يؤكد المعرض الطلب أو يلغيه.",
    unavailableSkipped: (n) => `${n} منتج غير متاح الآن ولن يدخل في الطلب.`,
    problemName: "أدخل اسمك (حرفان على الأقل).",
    problemPhone: "أدخل رقم موبايل صحيحًا.",
    problemAddress: "اختر المحافظة والمنطقة واكتب العنوان بالتفصيل (٥ أحرف على الأقل).",
    problemChoice: (name) => `اختر طريقة استلام ودفع متاحة لدى ${name}.`,
    placedTitle: "تم إرسال طلبك",
    placedText: "سيراجع المعرض الطلب ويؤكده. يمكنك متابعة كل طلب من صفحة طلباتي.",
    placedInstapay: "إذا اخترت إنستاباي: افتح الطلب وحوّل العربون وارفع صورة الإيصال.",
    viewOrder: (n) => `فتح الطلب ${n}`,
    myOrders: "طلباتي",
    ordersTitle: "طلباتي",
    ordersSubtitle: "كل الطلبات التي أنشأتها من الماركت.",
    ordersEmpty: "لم تنشئ أي طلب بعد.",
    continueShopping: "متابعة التسوق",
    pieces: (n) => `${n} قطعة`,
    orderTitle: (n) => `الطلب ${n}`,
    placedOn: "تاريخ الطلب",
    from: "المعرض",
    items: "المنتجات",
    qty: "الكمية",
    pickupFrom: "الاستلام من",
    deliverTo: "التوصيل إلى",
    status: {
      pending_confirmation: "بانتظار تأكيد المعرض",
      confirmed: "أكّده المعرض",
      processing: "قيد التجهيز",
      shipped: "خرج للتوصيل",
      ready_for_pickup: "جاهز للاستلام",
      delivered: "تم التسليم",
      delivery_failed: "تعذّر التوصيل",
      returned: "مرتجع",
      cancelled: "ملغي",
    },
    paymentStatus: {
      pending: "الدفع عند الاستلام",
      awaiting_deposit: "بانتظار العربون",
      deposit_submitted: "الإيصال قيد المراجعة",
      deposit_accepted: "تم قبول العربون",
      deposit_rejected: "تم رفض الإيصال",
      collected: "مدفوع",
      not_collected: "لم يُدفع",
      refund_due: "سيُرد إليك",
    },
    instapayTitle: "ادفع العربون عبر إنستاباي",
    instapaySend: (a) => `حوّل ${a} إلى:`,
    instapayTo: "عنوان إنستاباي",
    instapayName: "باسم",
    uploadReceipt: "ارفع صورة الإيصال",
    uploading: "جارٍ الرفع…",
    receiptHint: "صورة بصيغة JPG أو PNG أو WEBP، حتى ٥ ميجابايت.",
    receiptSent: "تم إرسال الإيصال، وسيراجعه المعرض.",
    receiptRejected: (note) => `رفض المعرض الإيصال: ${note}. حوّل مرة أخرى وارفع إيصالًا جديدًا.`,
    receipts: "الإيصالات",
    receiptStatus: { submitted: "قيد المراجعة", accepted: "مقبول", rejected: "مرفوض" },
    cancel: "إلغاء الطلب",
    cancelReason: "سبب الإلغاء (اختياري)",
    cancelConfirm: "نعم، ألغِ الطلب",
    cancelled: "تم إلغاء الطلب.",
    cancelReasonLabel: "سبب الإلغاء",
    history: "السجل",
    error: {
      unexpected: "حدثت مشكلة. حاول مرة أخرى.",
      auth_required: "سجّل الدخول للمتابعة.",
      account_inactive: "حسابك غير نشط حاليًا.",
      not_found: "الطلب غير موجود.",
      cart_changed: "تغيّر منتج في السلة أو لم يعد متاحًا. عُد إلى السلة وراجعها.",
      insufficient_stock: "قلّت الكمية المتاحة من أحد المنتجات. عُد إلى السلة وراجع الكميات.",
      invalid_quantity: "توجد كمية غير صحيحة. عُد إلى السلة.",
      duplicate_line: "يوجد منتج مكرر في السلة. عُد إلى السلة.",
      delivery_not_available: "أحد المعارض لا يوصّل إلى هذه المنطقة. اختر الاستلام أو منطقة أخرى.",
      pickup_not_available: "أحد المعارض لا يوفّر الاستلام.",
      payment_not_available: "لم تعد طريقة الدفع هذه متاحة لدى المعرض.",
      address_required: "اكتب العنوان بالتفصيل.",
      buyer_name_required: "أدخل اسمك.",
      buyer_phone_invalid: "أدخل رقم موبايل صحيحًا.",
      note_too_long: "الملاحظة طويلة (حتى ٥٠٠ حرف).",
      order_not_cancellable: "لا يمكن إلغاء الطلب بعد أن أكّده المعرض. تواصل مع المعرض.",
      proof_not_expected: "هذا الطلب لا ينتظر إيصالًا الآن.",
      image_type_invalid: "ارفع صورة بصيغة JPG أو PNG أو WEBP.",
      file_too_large: "حجم الصورة أكبر من ٥ ميجابايت.",
      upload_rate_limited: "رفعت إيصالات كثيرة. انتظر قليلًا وحاول مرة أخرى.",
      upload_failed: "فشل الرفع. حاول مرة أخرى.",
      image_content_invalid: "هذا الملف ليس صورة سليمة.",
      upload_not_found: "لم يكتمل الرفع. حاول مرة أخرى.",
      invalid_payload: "راجع البيانات وحاول مرة أخرى.",
    },
  },
  en: {
    home: "Home",
    marketplace: "Marketplace",
    cart: "Cart",
    checkoutTitle: "Checkout",
    checkoutSubtitle: "Enter your details and choose how to receive and pay for each showroom.",
    signInTitle: "Sign in to place your order",
    signInText: "Your cart is saved on this device. Sign in or create an account and you come back here to finish.",
    signIn: "Sign in",
    signUp: "Create account",
    backToCart: "Back to cart",
    emptyCart: "Your cart is empty.",
    loading: "Loading prices…",
    quoteFailed: "Prices could not be updated right now.",
    retry: "Try again",
    contactTitle: "Contact details",
    name: "Full name",
    phone: "Mobile number",
    phoneHint: "The showroom calls you on it to confirm the order.",
    note: "Note to the showroom (optional)",
    notePlaceholder: "For example: the best time to deliver",
    addressTitle: "Delivery address",
    governorate: "Governorate",
    chooseGovernorate: "Choose governorate",
    area: "Area",
    chooseArea: "Choose area",
    address: "Full address",
    addressPlaceholder: "Street, building number, floor, landmark",
    showroomTitle: (name) => `From ${name}`,
    receiving: "How you receive it",
    delivery: "Delivery",
    deliveryFee: (fee) => `Delivery fee ${fee}`,
    deliveryNeedsArea: "Choose the governorate and area to see the delivery price.",
    deliveryNotHere: "This showroom does not deliver to this area.",
    pickup: "Pick up from the showroom",
    pickupFree: "No delivery fee",
    pickupNotOffered: "This showroom does not offer pickup.",
    payment: "How you pay",
    cod: "Cash on delivery",
    codDesc: "Pay the whole amount when you receive it.",
    instapay: "InstaPay deposit",
    instapayDesc: (p) => (p >= 100 ? "Transfer the whole amount by InstaPay and upload the receipt." : `Transfer a ${p}% deposit by InstaPay and upload the receipt; the rest on delivery.`),
    gateway: "Online card payment",
    soon: "Soon",
    noPayment: "This showroom has not turned on a payment method yet, so you cannot order from it now.",
    products: "Products",
    deliveryLine: "Delivery",
    total: "Total",
    depositNow: (a) => `You transfer ${a} now`,
    grandTotal: "All orders total",
    exclVat: "Prices exclude VAT",
    place: "Place order",
    placing: "Placing your order…",
    reservedNote: "The quantities are held for you until the showroom confirms or cancels the order.",
    unavailableSkipped: (n) => `${n} products are not available now and are left out of the order.`,
    problemName: "Enter your name (at least 2 characters).",
    problemPhone: "Enter a valid mobile number.",
    problemAddress: "Choose the governorate and area and write the full address (at least 5 characters).",
    problemChoice: (name) => `Choose an available way to receive and pay for ${name}.`,
    placedTitle: "Your order was sent",
    placedText: "The showroom reviews and confirms it. Follow each order from My orders.",
    placedInstapay: "If you chose InstaPay: open the order, transfer the deposit and upload the receipt.",
    viewOrder: (n) => `Open order ${n}`,
    myOrders: "My orders",
    ordersTitle: "My orders",
    ordersSubtitle: "Every order you placed on the Marketplace.",
    ordersEmpty: "You have not placed an order yet.",
    continueShopping: "Continue shopping",
    pieces: (n) => `${n} pcs`,
    orderTitle: (n) => `Order ${n}`,
    placedOn: "Placed on",
    from: "Showroom",
    items: "Items",
    qty: "Qty",
    pickupFrom: "Pick up from",
    deliverTo: "Deliver to",
    status: {
      pending_confirmation: "Waiting for the showroom",
      confirmed: "Confirmed by the showroom",
      processing: "Being prepared",
      shipped: "Out for delivery",
      ready_for_pickup: "Ready for pickup",
      delivered: "Delivered",
      delivery_failed: "Delivery failed",
      returned: "Returned",
      cancelled: "Cancelled",
    },
    paymentStatus: {
      pending: "Pay on delivery",
      awaiting_deposit: "Waiting for your deposit",
      deposit_submitted: "Receipt under review",
      deposit_accepted: "Deposit accepted",
      deposit_rejected: "Receipt rejected",
      collected: "Paid",
      not_collected: "Not paid",
      refund_due: "To be refunded",
    },
    instapayTitle: "Pay the deposit by InstaPay",
    instapaySend: (a) => `Transfer ${a} to:`,
    instapayTo: "InstaPay address",
    instapayName: "Account name",
    uploadReceipt: "Upload the receipt",
    uploading: "Uploading…",
    receiptHint: "A JPG, PNG or WEBP image, up to 5 MB.",
    receiptSent: "Receipt sent. The showroom will review it.",
    receiptRejected: (note) => `The showroom rejected the receipt: ${note}. Transfer again and upload a new receipt.`,
    receipts: "Receipts",
    receiptStatus: { submitted: "Under review", accepted: "Accepted", rejected: "Rejected" },
    cancel: "Cancel order",
    cancelReason: "Reason (optional)",
    cancelConfirm: "Yes, cancel the order",
    cancelled: "The order was cancelled.",
    cancelReasonLabel: "Cancellation reason",
    history: "History",
    error: {
      unexpected: "Something went wrong. Please try again.",
      auth_required: "Sign in to continue.",
      account_inactive: "Your account is not active right now.",
      not_found: "Order not found.",
      cart_changed: "A product in your cart changed or is no longer available. Go back to your cart and check it.",
      insufficient_stock: "A product has fewer units now. Go back to your cart and check the quantities.",
      invalid_quantity: "A quantity is not valid. Go back to your cart.",
      duplicate_line: "A product is in the cart twice. Go back to your cart.",
      delivery_not_available: "A showroom does not deliver to this area. Choose pickup or another area.",
      pickup_not_available: "A showroom does not offer pickup.",
      payment_not_available: "That payment method is no longer offered by the showroom.",
      address_required: "Write the full address.",
      buyer_name_required: "Enter your name.",
      buyer_phone_invalid: "Enter a valid mobile number.",
      note_too_long: "The note is too long (up to 500 characters).",
      order_not_cancellable: "The order cannot be cancelled after the showroom confirmed it. Contact the showroom.",
      proof_not_expected: "This order is not waiting for a receipt now.",
      image_type_invalid: "Upload a JPG, PNG or WEBP image.",
      file_too_large: "The image is larger than 5 MB.",
      upload_rate_limited: "Too many receipts uploaded. Wait a little and try again.",
      upload_failed: "The upload failed. Try again.",
      image_content_invalid: "This file is not a valid image.",
      upload_not_found: "The upload did not finish. Try again.",
      invalid_payload: "Check the details and try again.",
    },
  },
};

export function buyerError(locale: Locale, code: string): string {
  const errors = buyerCopy[locale].error;
  return errors[code] ?? errors.unexpected!;
}
