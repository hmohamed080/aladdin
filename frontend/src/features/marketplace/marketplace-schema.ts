import colorData from "./marketplace-colors.json";
import type { ColorEntry, FieldOption, SchemaField, TypeKey } from "./marketplace-types";

/** Shared Color Catalog (Draft V1) — one list for every product type. */
export const colorCatalog: ColorEntry[] = colorData as ColorEntry[];

const o = (key: string, ar: string, en: string): FieldOption => ({ key, name: { ar, en } });

/* ---- Draft V1 vocabularies (editable by Aladdin Admin; not a stock claim) ---- */
const latin = (...names: string[]) => names.map((n) => o(n.toLowerCase().replace(/[^a-z0-9]+/g, "_"), n, n));

const textures = {
  smooth: o("smooth", "ناعم", "Smooth"),
  grainy: o("grainy", "محبب", "Grainy"),
  embossed: o("embossed", "بارز", "Embossed"),
  fabric: o("fabric", "قماشي", "Fabric"),
  wood: o("wood", "خشبي", "Wood"),
  stone: o("stone", "حجري", "Stone"),
  carved: o("carved", "محفور", "Carved"),
};
const finishes = {
  matt: o("matt", "مط", "Matt"),
  gloss: o("gloss", "لامع", "Gloss"),
  semi_gloss: o("semi_gloss", "نصف لامع", "Semi-gloss"),
  polished: o("polished", "مصقول", "Polished"),
};

const field = (f: Omit<SchemaField, "required" | "filterable" | "variantAxis"> & Partial<Pick<SchemaField, "required" | "filterable" | "variantAxis">>): SchemaField => ({
  required: false,
  filterable: false,
  variantAxis: false,
  ...f,
});

const color = field({
  key: "color", valueType: "color", name: { ar: "اللون", en: "Color" },
  scope: "variant", required: true, filterable: true, variantAxis: true,
});
const dim = (key: string, ar: string, en: string, axis = false): SchemaField =>
  field({ key, valueType: "measurement", name: { ar, en }, scope: "variant", required: true, filterable: true, variantAxis: axis });
const weight = field({ key: "weight_g", valueType: "weight", name: { ar: "الوزن", en: "Weight" }, scope: "variant" });
const material = (options: FieldOption[]): SchemaField =>
  field({ key: "material", valueType: "option", name: { ar: "الخامة", en: "Material" }, scope: "product", required: true, filterable: true, options });
const pattern = (options: FieldOption[]): SchemaField =>
  field({ key: "pattern", valueType: "option", name: { ar: "التصميم", en: "Design" }, scope: "product", filterable: true, options });
const texture = (options: FieldOption[]): SchemaField =>
  field({ key: "texture", valueType: "option", name: { ar: "الملمس", en: "Texture" }, scope: "product", filterable: true, options });
const finish = (options: FieldOption[]): SchemaField =>
  field({ key: "finish", valueType: "option", name: { ar: "التشطيب", en: "Surface finish" }, scope: "product", filterable: true, options });
const flag = (key: string, ar: string, en: string, filterable = true): SchemaField =>
  field({ key, valueType: "boolean", name: { ar, en }, scope: "product", filterable });

/** Schema per product type. Generated UI (filters, pickers, spec table) reads only this. */
export const typeSchemas: Record<TypeKey, SchemaField[]> = {
  wallpaper: [
    material(latin("Paper", "Vinyl", "Non-woven", "Fabric", "Vinyl-coated")),
    pattern([o("plain", "سادة", "Plain"), o("geometric", "هندسي", "Geometric"), o("floral", "نباتي", "Floral"), o("classic", "كلاسيك", "Classic"), o("marble", "رخامي", "Marble"), o("wood", "خشبي", "Wood"), o("three_d", "ثلاثي الأبعاد", "3D"), o("kids", "أطفال", "Kids")]),
    texture([textures.smooth, textures.grainy, textures.embossed, textures.fabric]),
    flag("washable", "قابل للغسيل", "Washable"),
    color,
    dim("roll_width_mm", "عرض الرول", "Roll width", true),
    dim("roll_length_mm", "طول الرول", "Roll length"),
    weight,
  ],
  wood_alternative: [
    material(latin("PVC", "WPC", "MDF", "PS")),
    pattern([o("slats", "شرائح طولية", "Longitudinal slats"), o("fluted", "مضلع", "Fluted"), o("wood_grain", "عروق خشبية", "Wood grain"), o("plain", "سادة", "Plain"), o("geometric", "هندسي", "Geometric")]),
    texture([textures.smooth, textures.wood, textures.grainy, textures.embossed]),
    finish([finishes.matt, finishes.gloss, finishes.semi_gloss]),
    flag("moisture_resistant", "مقاوم للرطوبة", "Moisture resistant"),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  marble_alternative: [
    material(latin("PVC", "SPC", "Verified composite")),
    pattern([o("gold_veins", "عروق ذهبية", "Gold veins"), o("grey_veins", "عروق رمادية", "Grey veins"), o("black_veins", "عروق سوداء", "Black veins"), o("natural_stone", "شكل حجر طبيعي", "Natural-stone look"), o("plain", "سادة", "Plain")]),
    texture([textures.smooth, textures.stone, textures.grainy]),
    finish([finishes.matt, finishes.gloss]),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  sheeboard: [
    // Actual material is mandatory and is never pre-selected (DL-18).
    material(latin("Particleboard", "MDF", "PVC Foam Board", "WPC", "Other verified material")),
    pattern([o("wood", "خشبي", "Wood"), o("plain", "سادة", "Plain"), o("marble", "رخامي", "Marble"), o("geometric", "هندسي", "Geometric")]),
    texture([textures.smooth, textures.wood, textures.grainy]),
    finish([finishes.matt, finishes.gloss]),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  cornice: [
    material(latin("PU", "PS", "Gypsum", "PVC")),
    pattern([o("plain", "سادة", "Plain"), o("classic", "كلاسيك", "Classic"), o("modern", "مودرن", "Modern"), o("ornate", "مزخرف", "Ornate")]),
    texture([textures.smooth, textures.embossed, textures.carved]),
    flag("paintable", "قابل للدهان", "Paintable"),
    flag("led_compatible", "يدعم إضاءة LED", "LED compatible"),
    dim("length_mm", "طول العود", "Bar length", true),
    dim("profile_width_mm", "عرض القطاع", "Profile width"),
    dim("profile_height_mm", "ارتفاع القطاع", "Profile height", true),
    weight,
  ],
  corner_trim: [
    field({
      key: "kind", valueType: "option", name: { ar: "النوع", en: "Type" }, scope: "product", required: true, filterable: true,
      options: [o("internal", "زاوية داخلية", "Internal corner"), o("external", "زاوية خارجية", "External corner"), o("end", "زاوية نهاية", "End corner")],
    }),
    material(latin("Aluminum", "PVC", "Stainless steel", "WPC")),
    finish([finishes.matt, finishes.gloss, finishes.polished]),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("profile_mm", "مقاس القطاع", "Profile size", true),
    weight,
  ],
  panels: [
    material(latin("PVC", "WPC", "MDF", "Gypsum", "Acoustic felt")),
    pattern([o("plain", "سادة", "Plain"), o("fluted", "مضلع", "Fluted"), o("geometric", "هندسي", "Geometric"), o("three_d", "ثلاثي الأبعاد", "3D")]),
    finish([finishes.matt, finishes.gloss, finishes.semi_gloss]),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  skirting: [
    material(latin("PVC", "PS", "MDF", "WPC", "Aluminum")),
    finish([finishes.matt, finishes.gloss]),
    flag("paintable", "قابل للدهان", "Paintable"),
    color,
    dim("length_mm", "طول العود", "Bar length"),
    dim("profile_height_mm", "الارتفاع", "Height", true),
    weight,
  ],
  interior_doors: [
    material(latin("Wood", "HDF", "WPC", "PVC", "Aluminum")),
    finish([finishes.matt, finishes.gloss, finishes.semi_gloss]),
    color,
    dim("height_mm", "الارتفاع", "Height", true),
    dim("width_mm", "العرض", "Width", true),
    dim("thickness_mm", "السُمك", "Thickness"),
    weight,
  ],
  armored_doors: [
    material(latin("Steel", "Steel with wood cladding", "Steel with aluminum cladding")),
    finish([finishes.matt, finishes.gloss]),
    flag("fire_resistant", "مقاوم للحريق", "Fire resistant"),
    color,
    dim("height_mm", "الارتفاع", "Height", true),
    dim("width_mm", "العرض", "Width", true),
    dim("thickness_mm", "السُمك", "Thickness"),
    weight,
  ],
  vinyl_flooring: [
    material(latin("Vinyl", "Luxury vinyl tile", "Vinyl sheet")),
    pattern([o("wood", "خشبي", "Wood"), o("stone", "حجري", "Stone"), o("plain", "سادة", "Plain"), o("geometric", "هندسي", "Geometric")]),
    texture([textures.smooth, textures.wood, textures.embossed]),
    flag("water_resistant", "مقاوم للماء", "Water resistant"),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  spc_flooring: [
    material(latin("SPC")),
    pattern([o("wood", "خشبي", "Wood"), o("stone", "حجري", "Stone"), o("plain", "سادة", "Plain")]),
    texture([textures.smooth, textures.wood, textures.embossed]),
    flag("water_resistant", "مقاوم للماء", "Water resistant"),
    color,
    dim("length_mm", "الطول", "Length"),
    dim("width_mm", "العرض", "Width"),
    dim("thickness_mm", "السُمك", "Thickness", true),
    weight,
  ],
  curtains: [
    material(latin("Polyester", "Cotton", "Linen", "Velvet", "Blackout fabric")),
    pattern([o("plain", "سادة", "Plain"), o("striped", "مقلم", "Striped"), o("floral", "نباتي", "Floral"), o("geometric", "هندسي", "Geometric")]),
    flag("blackout", "حاجب للضوء", "Blackout"),
    color,
    dim("width_mm", "العرض", "Width", true),
    dim("height_mm", "الارتفاع", "Height", true),
    weight,
  ],
  posters: [
    material(latin("Paper", "Canvas", "Vinyl", "Fabric")),
    pattern([o("abstract", "تجريدي", "Abstract"), o("nature", "طبيعة", "Nature"), o("typography", "كتابة", "Typography"), o("kids", "أطفال", "Kids")]),
    dim("width_mm", "العرض", "Width", true),
    dim("height_mm", "الارتفاع", "Height", true),
    weight,
  ],
  paints: [
    field({
      key: "base", valueType: "option", name: { ar: "الأساس", en: "Base" }, scope: "product", required: true, filterable: true,
      options: [o("water", "مائي", "Water-based"), o("oil", "زيتي", "Oil-based"), o("other", "أخرى", "Other")],
    }),
    finish([finishes.matt, finishes.gloss, finishes.semi_gloss]),
    flag("interior", "للاستخدام الداخلي", "Interior use"),
    flag("exterior", "للاستخدام الخارجي", "Exterior use"),
    color,
    weight,
  ],
};

export function fieldOptionName(f: SchemaField, key: string, locale: "ar" | "en"): string {
  if (f.valueType === "color") return colorCatalog.find((c) => c.key === key)?.name[locale] ?? key;
  return f.options?.find((x) => x.key === key)?.name[locale] ?? key;
}

/** Options a field offers (colors come from the shared catalog). */
export function fieldOptions(f: SchemaField): FieldOption[] {
  if (f.valueType === "color") return colorCatalog.map((c) => ({ key: c.key, name: c.name }));
  return f.options ?? [];
}
