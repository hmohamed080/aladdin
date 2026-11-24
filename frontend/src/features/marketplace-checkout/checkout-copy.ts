import type { Locale } from "@/features/marketplace/marketplace-types";
import { buyerError } from "@/features/marketplace-orders/buyer-copy";

/** Checkout v2 wording (Marketplace PR 12), Arabic first. Receipts, addresses and phones are never echoed into a message. */
type Copy = {
  title: string;
  subtitle: string;
  receiving: string;
  delivery: string;
  pickup: string;
  speed: string;
  standard: string;
  nextDay: (arrival: string, fee: string) => string;
  address: string;
  chooseAddress: string;
  addAddress: string;
  payment: string;
  cod: string;
  codDesc: string;
  instapayFull: string;
  instapayFullDesc: string;
  instapayDeposit: (pct: number) => string;
  instapayDepositDesc: string;
  gateway: string;
  soon: string;
  receiptTitle: string;
  receiptHelp: (address: string, name: string, amount: string) => string;
  receiptUpload: string;
  receiptUploaded: string;
  receiptRemove: string;
  receiptBusy: string;
  note: string;
  notePlaceholder: string;
  summary: string;
  products: string;
  deliveryFee: string;
  free: string;
  total: string;
  payNow: string;
  balanceDue: string;
  estimate: (from: string, to: string) => string;
  nonReturnableTitle: string;
  nonReturnableText: (names: string) => string;
  confirm: string;
  confirming: string;
  holdNote: string;
  backToCart: string;
  empty: string;
  continueShopping: string;
  loading: string;
  retry: string;
  notReady: string;
  missing: Record<string, string>;
  signInTitle: string;
  signInText: string;
  signIn: string;
  signUp: string;
  thanksTitle: (name: string) => string;
  thanksText: string;
  orderNumber: string;
  progress: string;
  steps: [string, string, string, string];
  summaryTitle: string;
  paymentMethod: Record<string, string>;
  viewOrder: string;
  myOrders: string;
  pickupAt: string;
  deliveryTo: string;
};

export const checkoutCopy: Record<Locale, Copy> = {
  ar: {
    title: "إتمام الطلب",
    subtitle: "راجع التوصيل والدفع ثم أكّد الطلب. الأسعار يحسبها النظام.",
    receiving: "الاستلام",
    delivery: "توصيل",
    pickup: "استلام من الفرع",
    speed: "سرعة التوصيل",
    standard: "عادي",
    nextDay: (arrival, fee) => `اليوم التالي — يصل ${arrival} (${fee})`,
    address: "عنوان التوصيل",
    chooseAddress: "اختر عنوانًا محفوظًا",
    addAddress: "إضافة عنوان",
    payment: "طريقة الدفع",
    cod: "الدفع عند الاستلام",
    codDesc: "تدفع المبلغ كاملًا عند استلام الطلب.",
    instapayFull: "إنستاباي بالكامل",
    instapayFullDesc: "تحوّل المبلغ كاملًا وترفع إيصال التحويل قبل التأكيد.",
    instapayDeposit: (pct) => `إنستاباي عربون ${pct}%`,
    instapayDepositDesc: "تحوّل العربون الآن وتدفع الباقي عند الاستلام.",
    gateway: "الدفع بالبطاقة",
    soon: "قريبًا",
    receiptTitle: "إيصال التحويل",
    receiptHelp: (address, name, amount) => `حوّل ${amount} إلى ${address} باسم ${name}، ثم ارفع صورة الإيصال. لا يمكن تأكيد الطلب قبل رفعه.`,
    receiptUpload: "رفع الإيصال",
    receiptUploaded: "تم رفع الإيصال",
    receiptRemove: "حذف الإيصال",
    receiptBusy: "جارٍ رفع الإيصال والتحقق منه…",
    note: "ملاحظة للمعرض (اختياري)",
    notePlaceholder: "مثلًا: برجاء الاتصال قبل الوصول",
    summary: "ملخص الطلب",
    products: "المنتجات",
    deliveryFee: "التوصيل",
    free: "مجاني",
    total: "الإجمالي",
    payNow: "المدفوع الآن",
    balanceDue: "المتبقي عند الاستلام",
    estimate: (from, to) => (from === to ? `يصل ${from}` : `يصل بين ${from} و${to}`),
    nonReturnableTitle: "منتجات غير قابلة للإرجاع",
    nonReturnableText: (names) => `هذه المنتجات لا تُرجع بعد الاستلام: ${names}.`,
    confirm: "تأكيد الطلب",
    confirming: "جارٍ تأكيد الطلب…",
    holdNote: "الكميات تُحجز لك فور تأكيد الطلب، ويبدأ المعرض التجهيز دون موافقة إضافية.",
    backToCart: "العودة إلى السلة",
    empty: "سلتك فارغة.",
    continueShopping: "متابعة التسوق",
    loading: "جارٍ تجهيز الطلب…",
    retry: "إعادة المحاولة",
    notReady: "أكمل البيانات الناقصة لتأكيد الطلب.",
    missing: {
      insufficient_stock: "إحدى الكميات لم تعد متاحة. عدّل السلة.",
      address_missing: "اختر عنوان توصيل محفوظًا.",
      phone_unverified: "وثّق رقم هاتف حسابك أولًا من إعدادات العناوين.",
      delivery_not_available: "المعرض لا يوصّل إلى هذا العنوان.",
      next_day_not_available: "التوصيل في اليوم التالي غير متاح لهذا العنوان.",
      pickup_not_available: "المعرض لا يوفّر الاستلام من الفرع.",
      payment_not_available: "طريقة الدفع غير متاحة لدى المعرض.",
      receipt_required: "ارفع إيصال التحويل لتأكيد الطلب.",
    },
    signInTitle: "سجّل الدخول لإتمام الطلب",
    signInText: "سلتك محفوظة على جهازك.",
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    thanksTitle: (name) => (name ? `شكرًا ${name}!` : "شكرًا لك!"),
    thanksText: "استلمنا طلبك وأبلغنا المعرض. سنخبرك بكل خطوة.",
    orderNumber: "رقم الطلب",
    progress: "مراحل الطلب",
    steps: ["تم استلام الطلب", "قيد التجهيز", "في الطريق أو جاهز للاستلام", "تم التسليم"],
    summaryTitle: "ملخص الطلب",
    paymentMethod: { cod: "الدفع عند الاستلام", instapay_full: "إنستاباي بالكامل", instapay_deposit: "إنستاباي عربون" },
    viewOrder: "تتبّع الطلب",
    myOrders: "طلباتي",
    pickupAt: "الاستلام من",
    deliveryTo: "التوصيل إلى",
  },
  en: {
    title: "Checkout",
    subtitle: "Review delivery and payment, then confirm. The system calculates every price.",
    receiving: "Receiving",
    delivery: "Delivery",
    pickup: "Branch pickup",
    speed: "Delivery speed",
    standard: "Standard",
    nextDay: (arrival, fee) => `Next day — arrives ${arrival} (${fee})`,
    address: "Delivery address",
    chooseAddress: "Choose a saved address",
    addAddress: "Add an address",
    payment: "Payment",
    cod: "Cash on delivery",
    codDesc: "Pay the full amount when you receive the order.",
    instapayFull: "InstaPay in full",
    instapayFullDesc: "Transfer the full amount and upload the receipt before confirming.",
    instapayDeposit: (pct) => `InstaPay deposit ${pct}%`,
    instapayDepositDesc: "Transfer the deposit now and pay the rest on receipt.",
    gateway: "Card payment",
    soon: "Coming soon",
    receiptTitle: "Transfer receipt",
    receiptHelp: (address, name, amount) => `Transfer ${amount} to ${address} (account name ${name}), then upload a photo of the receipt. The order cannot be confirmed before it is uploaded.`,
    receiptUpload: "Upload receipt",
    receiptUploaded: "Receipt uploaded",
    receiptRemove: "Remove receipt",
    receiptBusy: "Uploading and checking the receipt…",
    note: "Note for the showroom (optional)",
    notePlaceholder: "For example: please call before arriving",
    summary: "Order summary",
    products: "Products",
    deliveryFee: "Delivery",
    free: "Free",
    total: "Total",
    payNow: "Paid now",
    balanceDue: "Due on receipt",
    estimate: (from, to) => (from === to ? `Arrives ${from}` : `Arrives between ${from} and ${to}`),
    nonReturnableTitle: "Non-returnable items",
    nonReturnableText: (names) => `These items cannot be returned after receipt: ${names}.`,
    confirm: "Confirm order",
    confirming: "Confirming…",
    holdNote: "The quantities are held for you as soon as you confirm, and the showroom starts preparing without a further approval.",
    backToCart: "Back to the cart",
    empty: "Your cart is empty.",
    continueShopping: "Continue shopping",
    loading: "Preparing your order…",
    retry: "Try again",
    notReady: "Complete what is missing to confirm the order.",
    missing: {
      insufficient_stock: "One of the quantities is no longer available. Edit the cart.",
      address_missing: "Choose a saved delivery address.",
      phone_unverified: "Verify your account phone first (in the address settings).",
      delivery_not_available: "The showroom does not deliver to this address.",
      next_day_not_available: "Next-day delivery is not available for this address.",
      pickup_not_available: "The showroom does not offer branch pickup.",
      payment_not_available: "This payment method is not available at the showroom.",
      receipt_required: "Upload the transfer receipt to confirm the order.",
    },
    signInTitle: "Sign in to place your order",
    signInText: "Your cart stays on this device.",
    signIn: "Sign in",
    signUp: "Create account",
    thanksTitle: (name) => (name ? `Thank you, ${name}!` : "Thank you!"),
    thanksText: "We received your order and told the showroom. We will keep you posted at every step.",
    orderNumber: "Order number",
    progress: "Order progress",
    steps: ["Order received", "Being prepared", "On the way or ready for pickup", "Delivered"],
    summaryTitle: "Order summary",
    paymentMethod: { cod: "Cash on delivery", instapay_full: "InstaPay in full", instapay_deposit: "InstaPay deposit" },
    viewOrder: "Track the order",
    myOrders: "My orders",
    pickupAt: "Pickup at",
    deliveryTo: "Delivery to",
  },
};

export const checkoutError = buyerError;
