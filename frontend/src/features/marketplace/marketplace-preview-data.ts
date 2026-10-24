import type { PreviewProduct, PreviewVariant, TypeKey } from "./marketplace-types";

/**
 * SAMPLE DATA for the Marketplace UI preview. Not live products, prices, stock
 * or offers; no seller exists yet. Replaced by the public Marketplace read
 * model when the backend is approved.
 */
const img = (type: TypeKey, n: 1 | 2) => `/preview/landing/marketplace/${type}-${n}.png`;

const pp = (name: string) => `/preview/landing/marketplace/pp-${name}.webp`;

const variant = (
  id: string,
  sku: string,
  priceEgp: number,
  stock: number,
  values: PreviewVariant["values"],
): PreviewVariant => ({ id, sku, priceEgp, stock, values });

const baseProducts: PreviewProduct[] = [
  {
    id: "p-wp-1", slug: "premium-wallpaper", type: "wallpaper", unit: "roll", minOrderQty: 1, qtyStep: 1,
    name: { ar: "ورق حائط فاخر", en: "Premium wallpaper" },
    description: {
      ar: "ورق حائط بنقوش عصرية بلمسات ذهبية يناسب غرف المعيشة والاستقبال، سهل التركيب ويحافظ على لونه.",
      en: "Wallpaper with modern patterns and gold accents for living and reception rooms. Easy to install and colour-fast.",
    },
    brand: "Sample Brand", images: [img("wallpaper", 1)],
    values: { material: "vinyl", pattern: "floral", texture: "embossed", washable: true },
    offer: { kind: "flash", referencePriceEgp: 750 },
    publishedAt: "2026-10-10",
    variants: [
      variant("v-wp-1a", "WP-001-GR-53", 550, 24, { color: "light_grey", roll_width_mm: 530, roll_length_mm: 10000 }),
      variant("v-wp-1b", "WP-001-BG-53", 550, 8, { color: "beige", roll_width_mm: 530, roll_length_mm: 10000 }),
      variant("v-wp-1c", "WP-001-GR-106", 980, 0, { color: "light_grey", roll_width_mm: 1060, roll_length_mm: 10000 }),
    ],
  },
  {
    id: "p-wd-1", slug: "wall-wood-alternative", type: "wood_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل خشب جداري", en: "Wall wood alternative" },
    description: {
      ar: "ألواح جدارية بمظهر خشبي فاخر وسهلة التركيب، مناسبة للحوائط الداخلية.",
      en: "Wall panels with a premium wood look, easy to install on interior walls.",
    },
    brand: "Sample Brand", images: [img("wood_alternative", 1), img("wood_alternative", 2)],
    values: { material: "wpc", pattern: "slats", texture: "wood", finish: "matt", moisture_resistant: true },
    offer: { kind: "regular", referencePriceEgp: 850 },
    publishedAt: "2026-10-09",
    variants: [
      variant("v-wd-1a", "WD-100-OAK-8", 680, 40, { color: "oak", length_mm: 2400, width_mm: 120, thickness_mm: 8 }),
      variant("v-wd-1b", "WD-100-WAL-8", 705, 12, { color: "walnut", length_mm: 2400, width_mm: 120, thickness_mm: 8 }),
      variant("v-wd-1c", "WD-100-OAK-12", 760, 6, { color: "oak", length_mm: 2400, width_mm: 120, thickness_mm: 12 }),
    ],
  },
  {
    id: "p-mb-1", slug: "pvc-marble-alternative", type: "marble_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل رخام PVC", en: "PVC marble alternative" },
    description: {
      ar: "ألواح بديل رخام بعروق واضحة وسطح ناعم، حل عصري للحوائط والديكور.",
      en: "Marble-look panels with distinct veining and a smooth surface — a modern solution for walls and decor.",
    },
    brand: "Sample Brand", images: [img("marble_alternative", 1), img("marble_alternative", 2)],
    values: { material: "pvc", pattern: "gold_veins", texture: "smooth", finish: "gloss" },
    publishedAt: "2026-10-08",
    variants: [
      variant("v-mb-1a", "MB-200-WH-3", 720, 30, { color: "white", length_mm: 2800, width_mm: 1220, thickness_mm: 3 }),
      variant("v-mb-1b", "MB-200-BK-3", 760, 0, { color: "black", length_mm: 2800, width_mm: 1220, thickness_mm: 3 }),
    ],
  },
  {
    id: "p-sb-1", slug: "decorative-sheeboard", type: "sheeboard", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "شيبورد ديكوري", en: "Decorative sheeboard" },
    description: {
      ar: "ألواح شيبورد ديكورية متعددة الاستخدامات. الخامة الفعلية محددة في المواصفات أدناه.",
      en: "Versatile decorative sheeboard. The actual material is stated in the specifications below.",
    },
    brand: "Sample Brand", images: [img("sheeboard", 1)],
    values: { material: "particleboard", pattern: "wood", texture: "wood", finish: "matt" },
    publishedAt: "2026-10-07",
    variants: [
      variant("v-sb-1a", "SB-300-OAK-16", 420, 50, { color: "oak", length_mm: 2440, width_mm: 1220, thickness_mm: 16 }),
      variant("v-sb-1b", "SB-300-OAK-18", 465, 20, { color: "oak", length_mm: 2440, width_mm: 1220, thickness_mm: 18 }),
    ],
  },
  {
    id: "p-co-1", slug: "futec-cornices", type: "cornice", unit: "bar", minOrderQty: 1, qtyStep: 1,
    name: { ar: "كرانيش فيوتك", en: "Futec cornices" },
    description: {
      ar: "كرانيش بتصاميم كلاسيكية تناسب الأسقف المعلقة وتدعم الإضاءة المخفية.",
      en: "Classic-design cornices for suspended ceilings, compatible with concealed lighting.",
    },
    brand: "Sample Brand", images: [img("cornice", 1)],
    values: { material: "pu", pattern: "classic", texture: "embossed", paintable: true, led_compatible: true },
    publishedAt: "2026-10-06",
    variants: [
      variant("v-co-1a", "CO-400-10", 280, 60, { length_mm: 2400, profile_width_mm: 100, profile_height_mm: 100 }),
      variant("v-co-1b", "CO-400-15", 345, 25, { length_mm: 2400, profile_width_mm: 150, profile_height_mm: 150 }),
    ],
  },
  {
    id: "p-ct-1", slug: "decor-corner-trims", type: "corner_trim", unit: "bar", minOrderQty: 1, qtyStep: 1,
    name: { ar: "زوايا وحليات ديكور", en: "Decor corners and trims" },
    description: {
      ar: "زوايا معدنية بتشطيبات متعددة لحماية الأركان وإعطاء لمسة نهائية أنيقة.",
      en: "Metal corner trims in several finishes that protect edges and give a clean finishing touch.",
    },
    brand: "Sample Brand", images: [img("corner_trim", 1)],
    values: { kind: "external", material: "aluminum", finish: "polished" },
    publishedAt: "2026-10-05",
    variants: [
      variant("v-ct-1a", "CT-500-SIL-20", 180, 80, { color: "silver", length_mm: 2700, profile_mm: 20 }),
      variant("v-ct-1b", "CT-500-GLD-20", 215, 35, { color: "gold", length_mm: 2700, profile_mm: 20 }),
      variant("v-ct-1c", "CT-500-BLK-25", 230, 0, { color: "black", length_mm: 2700, profile_mm: 25 }),
    ],
  },
  {
    id: "p-wd-2", slug: "wood-alternative-boards", type: "wood_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "ألواح بديل خشب", en: "Wood alternative boards" },
    description: {
      ar: "ألواح مقاومة للرطوبة وسهلة التنظيف بتصميم مضلع.",
      en: "Moisture-resistant, easy-to-clean boards with a fluted design.",
    },
    brand: "Sample Brand", images: [img("wood_alternative", 2), img("wood_alternative", 1)],
    values: { material: "pvc", pattern: "fluted", texture: "smooth", finish: "semi_gloss", moisture_resistant: true },
    publishedAt: "2026-10-04",
    variants: [
      variant("v-wd-2a", "WD-110-DB-8", 610, 18, { color: "dark_brown", length_mm: 2400, width_mm: 160, thickness_mm: 8 }),
      variant("v-wd-2b", "WD-110-OAK-8", 610, 22, { color: "oak", length_mm: 2400, width_mm: 160, thickness_mm: 8 }),
    ],
  },
  {
    id: "p-mb-2", slug: "glossy-marble-alternative", type: "marble_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل رخام لامع", en: "Glossy marble alternative" },
    description: {
      ar: "سطح لامع بعروق طبيعية المظهر لإطلالة فاخرة.",
      en: "A glossy surface with natural-looking veins for a premium look.",
    },
    brand: "Sample Brand", images: [img("marble_alternative", 2)],
    values: { material: "spc", pattern: "natural_stone", texture: "stone", finish: "gloss" },
    publishedAt: "2026-10-03",
    variants: [
      variant("v-mb-2a", "MB-210-CR-5", 790, 14, { color: "cream", length_mm: 2800, width_mm: 1220, thickness_mm: 5 }),
      variant("v-mb-2b", "MB-210-BR-5", 820, 9, { color: "dark_brown", length_mm: 2800, width_mm: 1220, thickness_mm: 5 }),
    ],
  },
  {
    id: "p-mb-3", slug: "calacatta-gold-marble-alternative", type: "marble_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل رخام كالاكاتا جولد", en: "Calacatta Gold marble alternative" },
    description: {
      ar: "ألواح بديل رخام بعروق ذهبية على أرضية كريمية لامعة، مناسبة للحوائط الداخلية في غرف المعيشة والاستقبال والمحلات.",
      en: "Marble-look panels with gold veining on a glossy cream ground, suited to interior walls in living rooms, receptions and shops.",
    },
    highlights: {
      ar: ["مظهر رخام كالاكاتا بعروق ذهبية", "سطح لامع سهل التنظيف", "مناسب للاستخدام السكني والتجاري", "متوفر بعدة ألوان وسُمكين"],
      en: ["Calacatta marble look with gold veining", "Glossy surface that is easy to clean", "Suitable for residential and commercial spaces", "Available in several colours and two thicknesses"],
    },
    brand: "Sample Brand",
    images: [pp("calacatta-1"), pp("calacatta-2"), pp("calacatta-3"), pp("calacatta-4")],
    swatchImages: { off_white: pp("swatch-calacatta"), beige: pp("swatch-beige"), dark_grey: pp("swatch-dark-gray"), light_brown: pp("swatch-wood") },
    values: { material: "pvc", pattern: "gold_veins", texture: "smooth", finish: "gloss" },
    publishedAt: "2026-10-12",
    variants: [
      variant("v-mb-3a", "BT-MB-CAL-3", 850, 40, { color: "off_white", length_mm: 2800, width_mm: 1220, thickness_mm: 3, weight_g: 6500 }),
      variant("v-mb-3b", "BT-MB-CAL-5", 1050, 22, { color: "off_white", length_mm: 2800, width_mm: 1220, thickness_mm: 5, weight_g: 10800 }),
      variant("v-mb-3c", "BT-MB-BEI-3", 850, 18, { color: "beige", length_mm: 2800, width_mm: 1220, thickness_mm: 3, weight_g: 6500 }),
      variant("v-mb-3d", "BT-MB-BEI-5", 1050, 9, { color: "beige", length_mm: 2800, width_mm: 1220, thickness_mm: 5, weight_g: 10800 }),
      variant("v-mb-3e", "BT-MB-DGR-3", 890, 12, { color: "dark_grey", length_mm: 2800, width_mm: 1220, thickness_mm: 3, weight_g: 6500 }),
      variant("v-mb-3f", "BT-MB-DGR-5", 1090, 0, { color: "dark_grey", length_mm: 2800, width_mm: 1220, thickness_mm: 5, weight_g: 10800 }),
      variant("v-mb-3g", "BT-MB-WDN-3", 920, 7, { color: "light_brown", length_mm: 2800, width_mm: 1220, thickness_mm: 3, weight_g: 6500 }),
    ],
  },
  {
    id: "p-mb-4", slug: "gray-marble-alternative", type: "marble_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل رخام رمادي", en: "Gray marble alternative" },
    description: { ar: "ألواح بمظهر رخام رمادي هادئ للحوائط الداخلية.", en: "Panels with a calm grey marble look for interior walls." },
    brand: "Sample Brand", images: [pp("gray-marble"), pp("marble-closeup")],
    values: { material: "pvc", pattern: "grey_veins", texture: "smooth", finish: "matt" },
    publishedAt: "2026-10-11",
    variants: [variant("v-mb-4a", "BT-MB-GRY-3", 780, 25, { color: "light_grey", length_mm: 2800, width_mm: 1220, thickness_mm: 3, weight_g: 6300 })],
  },
  {
    id: "p-mb-5", slug: "beige-marble-alternative", type: "marble_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "بديل رخام بيج", en: "Beige marble alternative" },
    description: { ar: "ألواح بمظهر رخام بيج دافئ مع عروق ناعمة.", en: "Panels with a warm beige marble look and soft veining." },
    brand: "Sample Brand", images: [pp("beige-marble"), pp("marble-closeup")],
    values: { material: "spc", pattern: "natural_stone", texture: "smooth", finish: "gloss" },
    publishedAt: "2026-10-11",
    variants: [variant("v-mb-5a", "BT-MB-BGE-5", 1450, 14, { color: "beige", length_mm: 2800, width_mm: 1220, thickness_mm: 5, weight_g: 11200 })],
  },
  {
    id: "p-wd-3", slug: "wood-alternative-panel", type: "wood_alternative", unit: "board", minOrderQty: 1, qtyStep: 1,
    name: { ar: "لوح بديل خشب", en: "Wood alternative panel" },
    description: { ar: "لوح جداري بمظهر الخشب الطبيعي للديكورات الداخلية.", en: "A wall panel with a natural-wood look for interior decor." },
    brand: "Sample Brand", images: [pp("wood-alt"), pp("wood-accent")],
    values: { material: "ps", pattern: "wood_grain", texture: "wood", finish: "matt", moisture_resistant: false },
    publishedAt: "2026-10-10",
    variants: [variant("v-wd-3a", "BT-WD-PNL-8", 1250, 16, { color: "oak", length_mm: 2400, width_mm: 600, thickness_mm: 8, weight_g: 4200 })],
  },
  {
    id: "p-co-2", slug: "decorative-cornices", type: "cornice", unit: "bar", minOrderQty: 1, qtyStep: 1,
    name: { ar: "كرانيش ديكورية", en: "Decorative cornices" },
    description: { ar: "كرانيش مزخرفة بخطوط كلاسيكية للأسقف والحوائط.", en: "Ornate cornices with classic lines for ceilings and walls." },
    brand: "Sample Brand", images: [pp("cornices")],
    values: { material: "pu", pattern: "ornate", texture: "carved", paintable: true, led_compatible: false },
    publishedAt: "2026-10-09",
    variants: [variant("v-co-2a", "BT-CO-ORN-12", 320, 45, { length_mm: 2400, profile_width_mm: 120, profile_height_mm: 120, weight_g: 1800 })],
  },
  {
    id: "p-ct-2", slug: "decorative-corner-trims", type: "corner_trim", unit: "bar", minOrderQty: 1, qtyStep: 1,
    name: { ar: "زوايا ديكورية", en: "Decorative corner trims" },
    description: { ar: "زوايا ديكورية بتشطيب أنيق لحماية الأركان.", en: "Decorative corner trims with a clean finish that protect edges." },
    brand: "Sample Brand", images: [pp("corner-trims")],
    values: { kind: "external", material: "aluminum", finish: "matt" },
    publishedAt: "2026-10-09",
    variants: [variant("v-ct-2a", "BT-CT-DEC-20", 195, 60, { color: "gold", length_mm: 2700, profile_mm: 20, weight_g: 350 })],
  },
];

/** SAMPLE sales figures (not real sales) — they only drive the "best selling" order and badge in the preview. */
const sampleSales: Record<string, number> = {
  "p-mb-3": 300, "p-wd-1": 240, "p-wp-1": 180, "p-sb-1": 150, "p-mb-1": 120, "p-co-1": 95, "p-wd-2": 70, "p-ct-1": 55, "p-mb-2": 40,
};

export const previewProducts: PreviewProduct[] = baseProducts.map((p) => ({ ...p, salesCount: sampleSales[p.id] ?? 0 }));

/** The two top sellers carry the "best selling" badge. */
export const bestSellerIds: ReadonlySet<string> = new Set(
  [...previewProducts].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0)).slice(0, 2).map((p) => p.id),
);

export function findPreviewProduct(slug: string): PreviewProduct | undefined {
  return previewProducts.find((p) => p.slug === slug);
}
