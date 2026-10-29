import type { Locale, SaleUnit, TypeKey } from "./marketplace-types";

type Copy = {
  home: string;
  signIn: string;
  title: string;
  subtitle: string;
  previewChip: string;
  previewNote: string;
  searchLabel: string;
  searchPlaceholder: string;
  allTypes: string;
  typesLabel: string;
  types: Record<TypeKey, string>;
  filters: string;
  showFilters: string;
  clearAll: string;
  pickTypeHint: string;
  inStockOnly: string;
  yes: string;
  rangeCm: string;
  min: string;
  max: string;
  sortLabel: string;
  sort: { newest: string; best_selling: string; price_asc: string; price_desc: string };
  bestSeller: string;
  results: (n: number) => string;
  activeFilters: string;
  noResults: string;
  noResultsHint: string;
  from: string;
  currency: string;
  units: Record<SaleUnit, string>;
  inStock: string;
  outOfStock: string;
  special: string;
  flash: string;
  was: string;
  variants: (n: number) => string;
  addToCart: string;
  cartPreviewOnly: string;
  addedToCart: string;
  removeFromCart: string;
  viewCart: string;
  back: string;
  specs: string;
  chooseOptions: string;
  quantity: string;
  unavailableCombo: string;
  sku: string;
  minOrder: (n: number, unit: string) => string;
  gallery: string;
  notFoundTitle: string;
  notFoundText: string;
  heroTagline: string;
  heroLine: string;
  searchButton: string;
  trust: [string, string, string, string];
  flashBannerTitle: string;
  flashBannerText: string;
  flashBannerCta: string;
  hours: string;
  minutes: string;
  seconds: string;
  allProducts: string;
  filterResults: string;
  priceTitle: string;
  colorTitle: string;
  materialTitle: string;
  offersTitle: string;
  reset: string;
  showMore: (n: number) => string;
  showLess: string;
  gridView: string;
  listView: string;
  breadcrumb: string;
  favorite: string;
  cart: string;
  cartSoon: string;
  pagination: string;
  prev: string;
  next: string;
  page: (n: number) => string;
  ctaTitle: string;
  ctaText: string;
  ctaContact: string;
  ctaAccount: string;
  cardSpec: string;
  soon: string;
  buyNow: string;
  tabs: { details: string; specs: string; install: string; shipping: string; reviews: string };
  ratingSoon: string;
  guarantees: [string, string, string, string];
  relatedTitle: string;
  viewAll: string;
  saleUnit: string;
  dimensions: string;
  zoom: string;
  close: string;
  decrease: string;
  increase: string;
  sellerBadge: string;
  notAvailableYet: string;
};

export const marketplaceCopy = {
  ar: {
    home: "الرئيسية",
    signIn: "تسجيل الدخول",
    title: "سوق علاء الدين",
    subtitle: "منتجات التشطيبات والديكور في مكان واحد",
    previewChip: "معاينة — بيانات تجريبية",
    previewNote: "المنتجات والأسعار والمخزون هنا بيانات تجريبية للعرض فقط، ولا يوجد شراء فعلي بعد.",
    searchLabel: "ابحث في المنتجات",
    searchPlaceholder: "ابحث باسم المنتج أو الماركة",
    allTypes: "الكل",
    typesLabel: "أنواع المنتجات",
    types: {
      wallpaper: "ورق حائط",
      wood_alternative: "بديل خشب",
      marble_alternative: "بديل رخام",
      sheeboard: "شيبورد",
      cornice: "كرانيش",
      corner_trim: "زوايا",
      panels: "بانوهات",
      skirting: "وزر",
      interior_doors: "أبواب داخلية",
      armored_doors: "أبواب مصفحة",
      vinyl_flooring: "أرضيات فينيل",
      spc_flooring: "أرضيات SPC",
      curtains: "ستائر",
      posters: "بوسترات",
      paints: "دهانات",
    },
    filters: "تصفية",
    showFilters: "عرض خيارات التصفية",
    clearAll: "مسح الكل",
    pickTypeHint: "اختر نوع المنتج لتظهر لك خيارات التصفية الخاصة به (الخامة، اللون، المقاس…).",
    inStockOnly: "المتوفر فقط",
    yes: "نعم",
    rangeCm: "سم",
    min: "من",
    max: "إلى",
    sortLabel: "الترتيب",
    sort: { newest: "الأحدث", best_selling: "الأكثر مبيعًا", price_asc: "السعر: الأقل أولًا", price_desc: "السعر: الأعلى أولًا" },
    results: (n) => (n === 1 ? "منتج واحد" : `${n} منتجات`),
    activeFilters: "التصفية الحالية",
    noResults: "لا توجد منتجات مطابقة",
    noResultsHint: "جرّب إزالة بعض عوامل التصفية أو تغيير كلمة البحث.",
    from: "يبدأ من",
    currency: "ج.م",
    units: { roll: "للرول", board: "للوح", piece: "للقطعة", bar: "للعود", linear_meter: "للمتر الطولي", square_meter: "للمتر المربع", pack: "للعبوة" },
    inStock: "متوفر",
    outOfStock: "غير متوفر",
    special: "عرض خاص",
    bestSeller: "الأكثر مبيعًا",
    flash: "عروض خاطفة",
    was: "السعر السابق",
    variants: (n) => (n === 1 ? "خيار واحد" : `${n} خيارات`),
    addToCart: "أضف للسلة",
    cartPreviewOnly: "معاينة فقط — السلة غير مفعّلة بعد، ولم تتم أي إضافة.",
    addedToCart: "تمت الإضافة إلى السلة",
    removeFromCart: "حذف من السلة",
    viewCart: "عرض السلة",
    back: "العودة إلى السوق",
    specs: "المواصفات",
    chooseOptions: "اختر الخيارات",
    quantity: "الكمية",
    unavailableCombo: "هذا الاختيار غير متوفر حاليًا.",
    sku: "رمز المنتج",
    minOrder: (n, unit) => `أقل كمية: ${n} ${unit}`,
    gallery: "صور المنتج",
    notFoundTitle: "المنتج غير موجود",
    notFoundText: "قد يكون المنتج غير معروض حاليًا.",
    heroTagline: "اكتشف منتجات التشطيبات والديكور",
    heroLine: "كل ما تحتاجه لمشاريعك في مكان واحد",
    searchButton: "بحث",
    trust: ["توصيل لجميع المحافظات", "منتجات مضمونة", "دعم متخصص", "تجربة تسوق آمنة"],
    flashBannerTitle: "عروض خاطفة",
    flashBannerText: "خصومات حصرية على منتجات مختارة لفترة محدودة",
    flashBannerCta: "عرض جميع العروض",
    hours: "ساعة",
    minutes: "دقيقة",
    seconds: "ثانية",
    allProducts: "جميع المنتجات",
    filterResults: "تصفية النتائج",
    priceTitle: "السعر (جنيه مصري)",
    colorTitle: "اللون",
    materialTitle: "نوع المادة",
    offersTitle: "العروض",
    reset: "إعادة ضبط",
    showMore: (n) => `عرض المزيد (${n})`,
    showLess: "عرض أقل",
    gridView: "عرض شبكي",
    listView: "عرض قائمة",
    breadcrumb: "مسار التنقل",
    favorite: "أضف إلى المفضلة",
    cart: "السلة",
    cartSoon: "السلة غير مفعّلة بعد",
    pagination: "التنقل بين الصفحات",
    prev: "السابق",
    next: "التالي",
    page: (n) => `صفحة ${n}`,
    ctaTitle: "لم تجد ما تبحث عنه؟",
    ctaText: "تصفح المزيد من المنتجات أو تواصل معنا وسنساعدك في الوصول إلى المنتج المناسب.",
    ctaContact: "تواصل معنا",
    ctaAccount: "إنشاء حساب",
    cardSpec: "المواصفات",
    soon: "قريبًا",
    buyNow: "اشترِ الآن",
    tabs: { details: "تفاصيل المنتج", specs: "المواصفات", install: "دليل التركيب", shipping: "الشحن والإرجاع", reviews: "التقييمات" },
    ratingSoon: "التقييمات قريبًا",
    guarantees: ["دفع آمن", "إرجاع سهل", "توصيل سريع", "معارض موثوقة"],
    relatedTitle: "منتجات ذات صلة",
    viewAll: "عرض الكل",
    saleUnit: "وحدة البيع",
    dimensions: "الأبعاد (الطول × العرض × الارتفاع)",
    zoom: "تكبير الصورة",
    close: "إغلاق",
    decrease: "تقليل الكمية",
    increase: "زيادة الكمية",
    sellerBadge: "BestTrade",
    notAvailableYet: "هذه الميزة قيد الإعداد",
  },
  en: {
    home: "Home",
    signIn: "Sign in",
    title: "Aladdin Marketplace",
    subtitle: "Finishing and decoration products in one place",
    previewChip: "Preview — sample data",
    previewNote: "Products, prices and stock here are sample data for preview only; no real purchase exists yet.",
    searchLabel: "Search products",
    searchPlaceholder: "Search by product name or brand",
    allTypes: "All",
    typesLabel: "Product types",
    types: {
      wallpaper: "Wallpaper",
      wood_alternative: "Wood alternative",
      marble_alternative: "Marble alternative",
      sheeboard: "Sheeboard",
      cornice: "Cornices",
      corner_trim: "Corner trims",
      panels: "Panels",
      skirting: "Skirting",
      interior_doors: "Interior doors",
      armored_doors: "Armored doors",
      vinyl_flooring: "Vinyl flooring",
      spc_flooring: "SPC flooring",
      curtains: "Curtains",
      posters: "Posters",
      paints: "Paints",
    },
    filters: "Filters",
    showFilters: "Show filters",
    clearAll: "Clear all",
    pickTypeHint: "Choose a product type to see its own filters (material, color, size…).",
    inStockOnly: "In stock only",
    yes: "Yes",
    rangeCm: "cm",
    min: "From",
    max: "To",
    sortLabel: "Sort",
    sort: { newest: "Newest", best_selling: "Best selling", price_asc: "Price: low to high", price_desc: "Price: high to low" },
    results: (n) => (n === 1 ? "1 product" : `${n} products`),
    activeFilters: "Active filters",
    noResults: "No matching products",
    noResultsHint: "Try removing some filters or changing the search.",
    from: "From",
    currency: "EGP",
    units: { roll: "per roll", board: "per board", piece: "per piece", bar: "per bar", linear_meter: "per linear m", square_meter: "per m²", pack: "per pack" },
    inStock: "In stock",
    outOfStock: "Out of stock",
    special: "Special offer",
    bestSeller: "Best seller",
    flash: "Flash sale",
    was: "Previous price",
    variants: (n) => (n === 1 ? "1 option" : `${n} options`),
    addToCart: "Add to cart",
    cartPreviewOnly: "Preview only — the cart is not enabled yet; nothing was added.",
    addedToCart: "Added to cart",
    removeFromCart: "Remove from cart",
    viewCart: "View cart",
    back: "Back to marketplace",
    specs: "Specifications",
    chooseOptions: "Choose options",
    quantity: "Quantity",
    unavailableCombo: "This combination is not available right now.",
    sku: "SKU",
    minOrder: (n, unit) => `Minimum: ${n} ${unit}`,
    gallery: "Product images",
    notFoundTitle: "Product not found",
    notFoundText: "The product may not be listed right now.",
    heroTagline: "Discover finishing and decoration products",
    heroLine: "Everything your projects need, in one place",
    searchButton: "Search",
    trust: ["Delivery to all governorates", "Guaranteed products", "Specialist support", "Secure shopping"],
    flashBannerTitle: "Flash deals",
    flashBannerText: "Exclusive discounts on selected products for a limited time",
    flashBannerCta: "View all deals",
    hours: "hr",
    minutes: "min",
    seconds: "sec",
    allProducts: "All products",
    filterResults: "Filter results",
    priceTitle: "Price (EGP)",
    colorTitle: "Color",
    materialTitle: "Product type",
    offersTitle: "Offers",
    reset: "Reset",
    showMore: (n) => `Show more (${n})`,
    showLess: "Show less",
    gridView: "Grid view",
    listView: "List view",
    breadcrumb: "Breadcrumb",
    favorite: "Add to favourites",
    cart: "Cart",
    cartSoon: "The cart is not enabled yet",
    pagination: "Pagination",
    prev: "Previous",
    next: "Next",
    page: (n) => `Page ${n}`,
    ctaTitle: "Can’t find what you’re looking for?",
    ctaText: "Browse more products or contact us and we will help you find the right one.",
    ctaContact: "Contact us",
    ctaAccount: "Create account",
    cardSpec: "Specifications",
    soon: "Coming soon",
    buyNow: "Buy now",
    tabs: { details: "Product details", specs: "Specifications", install: "Installation guide", shipping: "Shipping & returns", reviews: "Reviews" },
    ratingSoon: "Ratings coming soon",
    guarantees: ["Secure payment", "Easy returns", "Fast delivery", "Trusted showrooms"],
    relatedTitle: "Related products",
    viewAll: "View all",
    saleUnit: "Sale unit",
    dimensions: "Dimensions (L × W × H)",
    zoom: "Zoom image",
    close: "Close",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    sellerBadge: "BestTrade",
    notAvailableYet: "This feature is being prepared",
  },
} satisfies Record<Locale, Copy>;

const number = new Intl.NumberFormat("en-US");

export function formatPrice(egp: number, locale: Locale): string {
  const c = marketplaceCopy[locale].currency;
  return locale === "ar" ? `${number.format(egp)} ${c}` : `${c} ${number.format(egp)}`;
}

/** A stored millimetre value shown in the unit people use: mm below 10 cm (thickness), cm above. */
export function formatLength(mm: number, locale: Locale): string {
  if (mm < 100) return `${Number.isInteger(mm) ? mm : mm.toFixed(1)} ${locale === "ar" ? "مم" : "mm"}`;
  return `${formatMm(mm)} ${locale === "ar" ? "سم" : "cm"}`;
}

/** Millimetres → cm for display (canonical storage is mm). */
export function formatMm(mm: number): string {
  const cm = mm / 10;
  return `${Number.isInteger(cm) ? cm : cm.toFixed(1)}`;
}

/** Weight is stored in grams; shown in g below 1 kg, otherwise kg. */
export function formatWeight(grams: number, locale: Locale): string {
  if (grams < 1000) return `${grams} ${locale === "ar" ? "جم" : "g"}`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0$/, "")} ${locale === "ar" ? "كجم" : "kg"}`;
}
