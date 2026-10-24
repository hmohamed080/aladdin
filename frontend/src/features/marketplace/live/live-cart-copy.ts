import type { Locale } from "../marketplace-types";

/**
 * Strings of the LIVE cart that the preview cart copy (../marketplace-cart-copy.ts) does not have.
 * Everything that is the same on both carts keeps coming from `cartCopy`.
 */
type LiveCartCopy = {
  subtitle: string;
  /** the trust strip (title, detail) — worded for what the platform really does */
  perks: [string, string][];
  checkoutSoon: string;
  soon: string;
  checkoutSoonNote: string;
  quoteFailed: string;
  retry: string;
  loading: string;
  unavailableLine: string;
  outOfStockLine: string;
  onlyAvailable: (n: string) => string;
  deliveryFeeByShowroom: string;
  noFee: string;
  showroomNoDelivery: (names: string) => string;
  showroomNoPickup: (names: string) => string;
  pickupDesc: string;
  chooseGovernorate: string;
  chooseArea: string;
  cartFull: string;
  addToCart: string;
  inCart: string;
  addedToCart: string;
  viewCart: string;
};

export const liveCartCopy = {
  ar: {
    subtitle: "راجع منتجاتك قبل إتمام الطلب",
    perks: [
      ["توصيل حسب منطقتك", "كل معرض يحدد سعر التوصيل"],
      ["منتجات من معارض متعددة", "على علاء الدين"],
      ["معارض معتمدة", "تتم مراجعة المعرض قبل النشر"],
      ["مساعدة في الاختيار", "تواصل معنا لأي استفسار"],
    ],
    checkoutSoon: "إتمام الطلب",
    soon: "قريبًا",
    checkoutSoonNote: "إتمام الطلب والدفع الإلكتروني سيتوفران قريبًا. تواصل مع المعرض لطلب المنتجات الآن.",
    quoteFailed: "تعذّر تحديث الأسعار الآن. حاول مرة أخرى.",
    retry: "إعادة المحاولة",
    loading: "جارٍ تحديث الأسعار…",
    unavailableLine: "لم يعد هذا المنتج متاحًا",
    outOfStockLine: "غير متوفر حاليًا",
    onlyAvailable: (n) => `المتاح ${n} فقط`,
    deliveryFeeByShowroom: "رسوم التوصيل حسب المعرض",
    noFee: "—",
    showroomNoDelivery: (names) => `لا يوصّل إلى هذه المنطقة: ${names}`,
    showroomNoPickup: (names) => `لا يوفّر الاستلام من المعرض: ${names}`,
    pickupDesc: "استلم طلبك بنفسك من المعرض دون رسوم توصيل",
    chooseGovernorate: "اختر المحافظة",
    chooseArea: "اختر المنطقة",
    cartFull: "السلة وصلت للحد الأقصى من المنتجات.",
    addToCart: "أضف إلى السلة",
    inCart: "في السلة",
    addedToCart: "تمت الإضافة إلى السلة",
    viewCart: "عرض السلة",
  },
  en: {
    subtitle: "Review your products before placing the order",
    perks: [
      ["Delivery by your area", "Each showroom sets its delivery price"],
      ["Products from many showrooms", "All on Aladdin"],
      ["Approved showrooms", "Every showroom is reviewed before it sells"],
      ["Help choosing", "Contact us with any question"],
    ],
    checkoutSoon: "Place order",
    soon: "Coming soon",
    checkoutSoonNote: "Placing the order and paying online are coming soon. Contact the showroom to order these products now.",
    quoteFailed: "Prices could not be updated right now. Try again.",
    retry: "Try again",
    loading: "Updating prices…",
    unavailableLine: "This product is no longer available",
    outOfStockLine: "Currently out of stock",
    onlyAvailable: (n) => `Only ${n} available`,
    deliveryFeeByShowroom: "Delivery fee by showroom",
    noFee: "—",
    showroomNoDelivery: (names) => `Does not deliver to this area: ${names}`,
    showroomNoPickup: (names) => `No showroom pickup: ${names}`,
    pickupDesc: "Collect your order yourself, with no delivery fee",
    chooseGovernorate: "Choose governorate",
    chooseArea: "Choose area",
    cartFull: "The cart has reached its maximum number of products.",
    addToCart: "Add to cart",
    inCart: "In cart",
    addedToCart: "Added to cart",
    viewCart: "View cart",
  },
} satisfies Record<Locale, LiveCartCopy>;
