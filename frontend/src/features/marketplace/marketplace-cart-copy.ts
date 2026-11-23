import type { Locale } from "./marketplace-types";

type CartCopy = {
  title: string;
  subtitle: string;
  breadcrumbCart: string;
  itemsTitle: (n: number) => string;
  colProduct: string;
  colUnitPrice: string;
  colQty: string;
  colTotal: string;
  seller: string;
  sku: string;
  color: string;
  size: string;
  remove: (name: string) => string;
  decrease: string;
  increase: string;
  qty: string;
  perks: [string, string][];
  alsoLike: string;
  bestSellers: string;
  offers: string;
  offerBadge: string;
  viewAll: string;
  prev: string;
  next: string;
  summary: string;
  itemsTotal: (n: number) => string;
  deliveryFee: string;
  deliveryFeeHint: string;
  orderTotal: string;
  orderTotalNote: string;
  method: string;
  delivery: string;
  deliveryDesc: string;
  pickup: string;
  pickupDesc: string;
  deliveryDetails: string;
  governorate: string;
  area: string;
  address: string;
  addressPlaceholder: string;
  chooseGovernorate: string;
  chooseArea: string;
  notAvailable: string;
  needArea: string;
  checkout: string;
  checkoutNext: string;
  continueShopping: string;
  emptyTitle: string;
  emptyText: string;
  currency: string;
  previewNote: string;
  added: string;
  viewCart: string;
  outOfStock: string;
  addToCart: string;
  removeFromCart: string;
  cm: string;
  free: string;
};

export const cartCopy = {
  ar: {
    title: "السلة",
    subtitle: "راجع منتجاتك قبل إتمام الطلب",
    breadcrumbCart: "السلة",
    itemsTitle: (n) => `المنتجات في السلة (${n})`,
    colProduct: "المنتج",
    colUnitPrice: "السعر (للوحدة)",
    colQty: "الكمية",
    colTotal: "الإجمالي",
    seller: "البائع",
    sku: "SKU",
    color: "اللون",
    size: "المقاس",
    remove: (name) => `حذف ${name} من السلة`,
    decrease: "تقليل الكمية",
    increase: "زيادة الكمية",
    qty: "الكمية",
    perks: [
      ["توصيل سريع", "لجميع المحافظات"],
      ["مئات المنتجات", "من أفضل المعارض والموردين"],
      ["ضمان الجودة", "منتجات أصلية ومعتمدة"],
      ["دعم فني متخصص", "مساعدة في اختيار المنتجات"],
    ],
    alsoLike: "قد تعجبك أيضًا",
    bestSellers: "الأكثر مبيعًا",
    offers: "عروض وخصومات",
    offerBadge: "عرض",
    viewAll: "عرض الكل",
    prev: "السابق",
    next: "التالي",
    summary: "ملخص الطلب",
    itemsTotal: (n) => `إجمالي المنتجات (${n})`,
    deliveryFee: "رسوم التوصيل",
    deliveryFeeHint: "تُحسب حسب المنطقة التي تختارها",
    orderTotal: "إجمالي الطلب",
    orderTotalNote: "المنتجات + رسوم التوصيل",
    method: "طريقة الاستلام",
    delivery: "التوصيل",
    deliveryDesc: "توصيل إلى عنوانك في جميع المحافظات",
    pickup: "الاستلام من المعرض",
    pickupDesc: "الاستلام من معرض BestTrade",
    deliveryDetails: "تفاصيل التوصيل",
    governorate: "المحافظة",
    area: "المنطقة / الحي",
    address: "العنوان بالتفصيل",
    addressPlaceholder: "مثال: شارع عباس العقاد، برج رقم 12، الدور 3",
    chooseGovernorate: "اختر المحافظة",
    chooseArea: "اختر المنطقة",
    notAvailable: "التوصيل غير متاح لهذه المنطقة حاليًا",
    needArea: "اختر المحافظة والمنطقة لتظهر رسوم التوصيل",
    checkout: "إتمام الطلب",
    checkoutNext: "خطوة إتمام الطلب قيد الإعداد — لم يتم إرسال أي طلب.",
    continueShopping: "متابعة التسوق",
    emptyTitle: "السلة فارغة",
    emptyText: "لم تضف أي منتجات بعد. تصفح السوق وأضف ما يناسبك.",
    currency: "ج.م",
    previewNote: "معاينة — المنتجات والأسعار ورسوم التوصيل بيانات تجريبية، ولا يتم إرسال أي طلب.",
    added: "تمت الإضافة إلى السلة",
    viewCart: "عرض السلة",
    outOfStock: "هذا المنتج غير متوفر حاليًا",
    addToCart: "أضف للسلة",
    removeFromCart: "حذف من السلة",
    cm: "سم",
    free: "مجانًا",
  },
  en: {
    title: "Cart",
    subtitle: "Review your products before placing the order",
    breadcrumbCart: "Cart",
    itemsTitle: (n) => `Items in cart (${n})`,
    colProduct: "Product",
    colUnitPrice: "Unit price",
    colQty: "Quantity",
    colTotal: "Total",
    seller: "Seller",
    sku: "SKU",
    color: "Color",
    size: "Size",
    remove: (name) => `Remove ${name} from cart`,
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    qty: "Quantity",
    perks: [
      ["Fast delivery", "To all governorates"],
      ["Hundreds of products", "From the best showrooms and suppliers"],
      ["Quality assurance", "Original, certified products"],
      ["Specialist support", "Help choosing products"],
    ],
    alsoLike: "You may also like",
    bestSellers: "Best sellers",
    offers: "Deals and offers",
    offerBadge: "Offer",
    viewAll: "View all",
    prev: "Previous",
    next: "Next",
    summary: "Order summary",
    itemsTotal: (n) => `Products total (${n})`,
    deliveryFee: "Delivery fee",
    deliveryFeeHint: "Calculated by the area you choose",
    orderTotal: "Order total",
    orderTotalNote: "Products + delivery fee",
    method: "Receiving method",
    delivery: "Delivery",
    deliveryDesc: "Delivered to your address in all governorates",
    pickup: "Pick up from showroom",
    pickupDesc: "Pick up from the BestTrade showroom",
    deliveryDetails: "Delivery details",
    governorate: "Governorate",
    area: "Area / district",
    address: "Detailed address",
    addressPlaceholder: "e.g. Abbas El Akkad St., Tower 12, 3rd floor",
    chooseGovernorate: "Choose governorate",
    chooseArea: "Choose area",
    notAvailable: "Delivery is not available to this area right now",
    needArea: "Choose a governorate and area to see the delivery fee",
    checkout: "Place order",
    checkoutNext: "The checkout step is being prepared — no order was sent.",
    continueShopping: "Continue shopping",
    emptyTitle: "Your cart is empty",
    emptyText: "You have not added any products yet. Browse the marketplace and add what you need.",
    currency: "EGP",
    previewNote: "Preview — products, prices and delivery fees are sample data, and no order is sent.",
    added: "Added to cart",
    viewCart: "View cart",
    outOfStock: "This product is out of stock",
    addToCart: "Add to cart",
    removeFromCart: "Remove from cart",
    cm: "cm",
    free: "Free",
  },
} satisfies Record<Locale, CartCopy>;

const number = new Intl.NumberFormat("en-US");
export function cartPrice(egp: number, locale: Locale): string {
  const c = cartCopy[locale].currency;
  return locale === "ar" ? `${number.format(egp)} ${c}` : `${c} ${number.format(egp)}`;
}
