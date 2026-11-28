import type { Locale } from "../marketplace-types";

/**
 * Strings of the LIVE cart that the preview cart copy (../marketplace-cart-copy.ts) does not have.
 * Everything that is the same on both carts keeps coming from `cartCopy`.
 */
type LiveCartCopy = {
  subtitle: string;
  /** the trust strip (title, detail) — worded for what the platform really does */
  checkoutSoon: string;
  soon: string;
  checkoutSoonNote: string;
  checkoutNote: string;
  quoteFailed: string;
  retry: string;
  loading: string;
  unavailableLine: string;
  outOfStockLine: string;
  onlyAvailable: (n: string) => string;
  deliveryFeeByShowroom: string;
  noFee: string;
  savedAddress: string;
  otherArea: string;
  addressAtCheckout: string;
  showroomNoDelivery: (names: string) => string;
  showroomNoPickup: (names: string) => string;
  pickupDesc: string;
  chooseGovernorate: string;
  chooseArea: string;
  cartFull: string;
  addToCart: string;
  chooseOptions: string;
  inCart: string;
  addedToCart: string;
  viewCart: string;
  /** PR 11: continue to checkout, sign-in modal, blocking lines, merge notice */
  continueToCheckout: string;
  blockedLines: string;
  signInTitle: string;
  signInText: string;
  signIn: string;
  signUp: string;
  continueBrowsing: string;
  closeDialog: string;
  mergeNote: (skipped: number, own: number) => string;
  dismiss: string;
};

export const liveCartCopy = {
  ar: {
    subtitle: "راجع منتجاتك قبل إتمام الطلب",
    checkoutSoon: "إتمام الطلب",
    soon: "قريبًا",
    checkoutSoonNote: "إتمام الطلب والدفع الإلكتروني سيتوفران قريبًا. تواصل مع المعرض لطلب المنتجات الآن.",
    checkoutNote: "في الخطوة التالية تسجّل الدخول وتختار طريقة الاستلام والدفع لكل معرض.",
    quoteFailed: "تعذّر تحديث الأسعار الآن. حاول مرة أخرى.",
    retry: "إعادة المحاولة",
    loading: "جارٍ تحديث الأسعار…",
    unavailableLine: "لم يعد هذا المنتج متاحًا",
    outOfStockLine: "غير متوفر حاليًا",
    onlyAvailable: (n) => `المتاح ${n} فقط`,
    deliveryFeeByShowroom: "رسوم التوصيل حسب المعرض",
    noFee: "—",
    savedAddress: "عنوان التوصيل المحفوظ",
    otherArea: "منطقة أخرى",
    addressAtCheckout: "تكتب العنوان بالتفصيل في خطوة إتمام الطلب.",
    showroomNoDelivery: (names) => `لا يوصّل إلى هذه المنطقة: ${names}`,
    showroomNoPickup: (names) => `لا يوفّر الاستلام من المعرض: ${names}`,
    pickupDesc: "استلم طلبك بنفسك من المعرض دون رسوم توصيل",
    chooseGovernorate: "اختر المحافظة",
    chooseArea: "اختر المنطقة",
    cartFull: "السلة وصلت للحد الأقصى من المنتجات.",
    addToCart: "أضف إلى السلة",
    chooseOptions: "اختر المواصفات",
    inCart: "في السلة",
    addedToCart: "تمت الإضافة إلى السلة",
    viewCart: "عرض السلة",
    continueToCheckout: "متابعة إلى إتمام الطلب",
    blockedLines: "أزل المنتجات المعلّمة (غير المتوفرة) لتتمكن من المتابعة.",
    signInTitle: "سجّل الدخول لمتابعة طلبك",
    signInText: "سلتك محفوظة على جهازك وستنتقل معك إلى حسابك بعد تسجيل الدخول، وتعود إلى هذه الصفحة نفسها.",
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    continueBrowsing: "العودة إلى السلة",
    closeDialog: "إغلاق",
    mergeNote: (skipped, own) =>
      own > 0
        ? `لم تُضف بعض المنتجات إلى حسابك لأنها من معرضك أو لم تعد متاحة (${skipped}). لا يمكنك الشراء من معرضك.`
        : `لم تُضف ${skipped} من المنتجات إلى حسابك لأنها لم تعد متاحة.`,
    dismiss: "تم",
  },
  en: {
    subtitle: "Review your products before placing the order",
    checkoutSoon: "Place order",
    soon: "Coming soon",
    checkoutSoonNote: "Placing the order and paying online are coming soon. Contact the showroom to order these products now.",
    checkoutNote: "Next you sign in and choose how to receive and pay for each showroom.",
    quoteFailed: "Prices could not be updated right now. Try again.",
    retry: "Try again",
    loading: "Updating prices…",
    unavailableLine: "This product is no longer available",
    outOfStockLine: "Currently out of stock",
    onlyAvailable: (n) => `Only ${n} available`,
    deliveryFeeByShowroom: "Delivery fee by showroom",
    noFee: "—",
    savedAddress: "Saved delivery address",
    otherArea: "Another area",
    addressAtCheckout: "You enter the detailed address at checkout.",
    showroomNoDelivery: (names) => `Does not deliver to this area: ${names}`,
    showroomNoPickup: (names) => `No showroom pickup: ${names}`,
    pickupDesc: "Collect your order yourself, with no delivery fee",
    chooseGovernorate: "Choose governorate",
    chooseArea: "Choose area",
    cartFull: "The cart has reached its maximum number of products.",
    addToCart: "Add to cart",
    chooseOptions: "Choose options",
    inCart: "In cart",
    addedToCart: "Added to cart",
    viewCart: "View cart",
    continueToCheckout: "Continue to checkout",
    blockedLines: "Remove the marked (unavailable) items to continue.",
    signInTitle: "Sign in to continue your order",
    signInText: "Your cart is saved on this device. It moves into your account when you sign in, and you come back to this same page.",
    signIn: "Sign in",
    signUp: "Create account",
    continueBrowsing: "Back to the cart",
    closeDialog: "Close",
    mergeNote: (skipped, own) =>
      own > 0
        ? `Some items were not added to your account because they belong to your own showroom or are no longer available (${skipped}). You cannot buy from your own showroom.`
        : `${skipped} item(s) were not added to your account because they are no longer available.`,
    dismiss: "OK",
  },
} satisfies Record<Locale, LiveCartCopy>;
