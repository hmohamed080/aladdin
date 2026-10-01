export type AccountCopy = { ar: string; en: string };
export type Specialty = AccountCopy & { value: string };
export type { LocationOption } from "@/lib/installer/location-data";
export { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";

export const PROFILE_STEPS = [
  { id: "basic", number: 1, label: { ar: "المعلومات الأساسية", en: "Basic information" } },
  { id: "availability", number: 2, label: { ar: "إتاحة العمل", en: "Work availability" } },
  { id: "portfolio", number: 3, label: { ar: "سابقة الأعمال", en: "Work history" } },
  { id: "coverage", number: 4, label: { ar: "نطاق العمل", en: "Work coverage" } },
] as const;

// Persistence contract for the future portfolio backend.
export const MAX_PORTFOLIO_PROJECTS = 10;
export const MAX_PORTFOLIO_IMAGES = 8;

export const SPECIALTIES: Specialty[] = [
  { value: "wallpaper-installation", en: "Wallpaper installation", ar: "تركيب ورق حائط" },
  { value: "gypsum-board-installation", en: "Gypsum board installation", ar: "تركيب جبس بورد" },
  { value: "wood-alternative-installation", en: "Wood-alternative installation", ar: "تركيب بديل الخشب" },
  { value: "marble-alternative-installation", en: "Marble-alternative installation", ar: "تركيب بديل الرخام" },
  { value: "vinyl-flooring-installation", en: "Vinyl flooring installation", ar: "تركيب أرضيات فينيل" },
  { value: "hdf-flooring-installation", en: "HDF flooring installation", ar: "تركيب أرضيات HDF" },
  { value: "painter-decorator", en: "Painter / decorator", ar: "نقاش ودهانات" },
  { value: "spray-painting", en: "Spray painting & surface prep", ar: "رش دوكو وتأسيس دهانات" },
  { value: "decorative-finishes", en: "Decorative finishes", ar: "تشطيبات ودهانات ديكورية" },
  { value: "wood-finishing", en: "Wood finishing & polishing (Astarji)", ar: "أسترجي وتشطيب أخشاب" },
  { value: "plastering-gypsum", en: "Plastering & gypsum", ar: "محارة وجبس" },
  { value: "epoxy-flooring", en: "Epoxy flooring", ar: "أرضيات إيبوكسي" },
  { value: "door-installation", en: "Door installation", ar: "تركيب أبواب" },
  { value: "futec-installation", en: "Futec installation", ar: "تركيب فيوتك" },
];

export const DEFAULT_SPECIALTIES = [
  "painter-decorator",
  "hdf-flooring-installation",
  "marble-alternative-installation",
] as const;

export const GOVERNORATE_OPTIONS: LocationOption[] = [
  { value: "cairo", ar: "القاهرة", en: "Cairo" },
  { value: "giza", ar: "الجيزة", en: "Giza" },
  { value: "alexandria", ar: "الإسكندرية", en: "Alexandria" },
  { value: "dakahlia", ar: "الدقهلية", en: "Dakahlia" },
  { value: "red-sea", ar: "البحر الأحمر", en: "Red Sea" },
  { value: "beheira", ar: "البحيرة", en: "Beheira" },
  { value: "fayoum", ar: "الفيوم", en: "Fayoum" },
  { value: "gharbia", ar: "الغربية", en: "Gharbia" },
  { value: "ismailia", ar: "الإسماعيلية", en: "Ismailia" },
  { value: "monufia", ar: "المنوفية", en: "Monufia" },
  { value: "minya", ar: "المنيا", en: "Minya" },
  { value: "qalyubia", ar: "القليوبية", en: "Qalyubia" },
  { value: "new-valley", ar: "الوادي الجديد", en: "New Valley" },
  { value: "suez", ar: "السويس", en: "Suez" },
  { value: "aswan", ar: "أسوان", en: "Aswan" },
  { value: "assiut", ar: "أسيوط", en: "Assiut" },
  { value: "beni-suef", ar: "بني سويف", en: "Beni Suef" },
  { value: "port-said", ar: "بورسعيد", en: "Port Said" },
  { value: "damietta", ar: "دمياط", en: "Damietta" },
  { value: "sharqia", ar: "الشرقية", en: "Sharqia" },
  { value: "south-sinai", ar: "جنوب سيناء", en: "South Sinai" },
  { value: "kafr-el-sheikh", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { value: "matrouh", ar: "مطروح", en: "Matrouh" },
  { value: "luxor", ar: "الأقصر", en: "Luxor" },
  { value: "qena", ar: "قنا", en: "Qena" },
  { value: "north-sinai", ar: "شمال سيناء", en: "North Sinai" },
  { value: "sohag", ar: "سوهاج", en: "Sohag" },
];

const otherCity: LocationOption = { value: "other", ar: "مدينة أخرى", en: "Other city" };

export const CITIES_BY_GOVERNORATE: Record<string, LocationOption[]> = {
  cairo: [
    { value: "new-cairo", ar: "القاهرة الجديدة", en: "New Cairo" },
    { value: "nasr-city", ar: "مدينة نصر", en: "Nasr City" },
    { value: "heliopolis", ar: "مصر الجديدة", en: "Heliopolis" },
    { value: "maadi", ar: "المعادي", en: "Maadi" },
    { value: "downtown", ar: "وسط البلد", en: "Downtown Cairo" },
    { value: "shorouk", ar: "الشروق", en: "El Shorouk" },
    { value: "badr", ar: "بدر", en: "Badr" },
    otherCity,
  ],
  giza: [
    { value: "giza-city", ar: "مدينة الجيزة", en: "Giza City" },
    { value: "sheikh-zayed", ar: "الشيخ زايد", en: "Sheikh Zayed" },
    { value: "october-6", ar: "السادس من أكتوبر", en: "6th of October" },
    { value: "dokki", ar: "الدقي", en: "Dokki" },
    { value: "mohandessin", ar: "المهندسين", en: "Mohandessin" },
    { value: "haram", ar: "الهرم", en: "Haram" },
    otherCity,
  ],
  alexandria: [
    { value: "alexandria-city", ar: "الإسكندرية", en: "Alexandria City" },
    { value: "borg-el-arab", ar: "برج العرب", en: "Borg El Arab" },
    { value: "amreya", ar: "العامرية", en: "Amreya" },
    otherCity,
  ],
  dakahlia: [{ value: "mansoura", ar: "المنصورة", en: "Mansoura" }, { value: "mit-ghamr", ar: "ميت غمر", en: "Mit Ghamr" }, { value: "belqas", ar: "بلقاس", en: "Belqas" }, otherCity],
  "red-sea": [{ value: "hurghada", ar: "الغردقة", en: "Hurghada" }, { value: "safaga", ar: "سفاجا", en: "Safaga" }, { value: "marsa-alam", ar: "مرسى علم", en: "Marsa Alam" }, otherCity],
  beheira: [{ value: "damanhur", ar: "دمنهور", en: "Damanhur" }, { value: "kafr-el-dawwar", ar: "كفر الدوار", en: "Kafr El Dawwar" }, { value: "rashid", ar: "رشيد", en: "Rosetta" }, otherCity],
  fayoum: [{ value: "fayoum-city", ar: "الفيوم", en: "Fayoum City" }, { value: "sinnuris", ar: "سنورس", en: "Sinnuris" }, { value: "ibshaway", ar: "إبشواي", en: "Ibshaway" }, otherCity],
  gharbia: [{ value: "tanta", ar: "طنطا", en: "Tanta" }, { value: "mahalla", ar: "المحلة الكبرى", en: "El Mahalla El Kubra" }, { value: "kafr-el-zayat", ar: "كفر الزيات", en: "Kafr El Zayat" }, otherCity],
  ismailia: [{ value: "ismailia-city", ar: "الإسماعيلية", en: "Ismailia City" }, { value: "fayed", ar: "فايد", en: "Fayed" }, { value: "el-qantara", ar: "القنطرة", en: "El Qantara" }, otherCity],
  monufia: [{ value: "shebin-el-kom", ar: "شبين الكوم", en: "Shebin El Kom" }, { value: "sadat-city", ar: "مدينة السادات", en: "Sadat City" }, { value: "menouf", ar: "منوف", en: "Menouf" }, otherCity],
  minya: [{ value: "minya-city", ar: "المنيا", en: "Minya City" }, { value: "mallawi", ar: "ملوي", en: "Mallawi" }, { value: "samalut", ar: "سمالوط", en: "Samalut" }, otherCity],
  qalyubia: [{ value: "banha", ar: "بنها", en: "Banha" }, { value: "shubra-el-kheima", ar: "شبرا الخيمة", en: "Shubra El Kheima" }, { value: "obour", ar: "العبور", en: "Obour" }, otherCity],
  "new-valley": [{ value: "kharga", ar: "الخارجة", en: "Kharga" }, { value: "dakhla", ar: "الداخلة", en: "Dakhla" }, { value: "farafra", ar: "الفرافرة", en: "Farafra" }, otherCity],
  suez: [{ value: "suez-city", ar: "السويس", en: "Suez City" }, { value: "ain-sokhna", ar: "العين السخنة", en: "Ain Sokhna" }, otherCity],
  aswan: [{ value: "aswan-city", ar: "أسوان", en: "Aswan City" }, { value: "kom-ombo", ar: "كوم أمبو", en: "Kom Ombo" }, { value: "edfu", ar: "إدفو", en: "Edfu" }, otherCity],
  assiut: [{ value: "assiut-city", ar: "أسيوط", en: "Assiut City" }, { value: "dairut", ar: "ديروط", en: "Dairut" }, { value: "manfalut", ar: "منفلوط", en: "Manfalut" }, otherCity],
  "beni-suef": [{ value: "beni-suef-city", ar: "بني سويف", en: "Beni Suef City" }, { value: "wasta", ar: "الواسطى", en: "El Wasta" }, { value: "biba", ar: "ببا", en: "Biba" }, otherCity],
  "port-said": [{ value: "port-said-city", ar: "بورسعيد", en: "Port Said City" }, { value: "port-fouad", ar: "بورفؤاد", en: "Port Fouad" }, otherCity],
  damietta: [{ value: "damietta-city", ar: "دمياط", en: "Damietta City" }, { value: "new-damietta", ar: "دمياط الجديدة", en: "New Damietta" }, { value: "ras-el-bar", ar: "رأس البر", en: "Ras El Bar" }, otherCity],
  sharqia: [{ value: "zagazig", ar: "الزقازيق", en: "Zagazig" }, { value: "tenth-ramadan", ar: "العاشر من رمضان", en: "10th of Ramadan" }, { value: "belbeis", ar: "بلبيس", en: "Belbeis" }, otherCity],
  "south-sinai": [{ value: "sharm-el-sheikh", ar: "شرم الشيخ", en: "Sharm El Sheikh" }, { value: "dahab", ar: "دهب", en: "Dahab" }, { value: "el-tor", ar: "الطور", en: "El Tor" }, otherCity],
  "kafr-el-sheikh": [{ value: "kafr-el-sheikh-city", ar: "كفر الشيخ", en: "Kafr El Sheikh City" }, { value: "desouk", ar: "دسوق", en: "Desouk" }, { value: "baltim", ar: "بلطيم", en: "Baltim" }, otherCity],
  matrouh: [{ value: "marsa-matrouh", ar: "مرسى مطروح", en: "Marsa Matrouh" }, { value: "el-alamein", ar: "العلمين", en: "El Alamein" }, { value: "siwa", ar: "سيوة", en: "Siwa" }, otherCity],
  luxor: [{ value: "luxor-city", ar: "الأقصر", en: "Luxor City" }, { value: "esna", ar: "إسنا", en: "Esna" }, { value: "armant", ar: "أرمنت", en: "Armant" }, otherCity],
  qena: [{ value: "qena-city", ar: "قنا", en: "Qena City" }, { value: "nag-hammadi", ar: "نجع حمادي", en: "Nag Hammadi" }, { value: "qift", ar: "قفط", en: "Qift" }, otherCity],
  "north-sinai": [{ value: "arish", ar: "العريش", en: "Arish" }, { value: "bir-el-abd", ar: "بئر العبد", en: "Bir El Abd" }, { value: "sheikh-zuwied", ar: "الشيخ زويد", en: "Sheikh Zuweid" }, otherCity],
  sohag: [{ value: "sohag-city", ar: "سوهاج", en: "Sohag City" }, { value: "akhmim", ar: "أخميم", en: "Akhmim" }, { value: "girga", ar: "جرجا", en: "Girga" }, otherCity],
};

export const AVAILABILITY_OPTIONS = [
  { id: "week", label: { ar: "خلال أسبوع", en: "Within a week" } },
  { id: "month", label: { ar: "خلال شهر", en: "Within a month" } },
  { id: "on-demand", label: { ar: "حسب الطلب", en: "On demand" } },
] as const;

export const PORTFOLIO_PROJECTS = [
  {
    id: "wood-flooring",
    title: { ar: "تركيب أرضيات خشبية", en: "Wood flooring installation" },
    location: { ar: "الجيزة · الشيخ زايد", en: "Giza · Sheikh Zayed" },
    description: {
      ar: "تركيب أرضيات خشبية لشقة ٢٠٠ متر مع تسليم التشطيب كاملًا.",
      en: "Installed wood flooring in a 200 m² apartment with complete finishing.",
    },
    cover: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    thumbnails: [
      "/assets/installer-dashboard/jobs/spc-flooring.jpg",
      "/assets/installer-dashboard/jobs/decorative-wall.png",
      "/assets/installer-dashboard/jobs/marble-alt.jpg",
    ],
    extraCount: 3,
  },
  {
    id: "villa-finishing",
    title: { ar: "تشطيب فيلا خاصة", en: "Private villa finishing" },
    location: { ar: "القاهرة · التجمع الخامس", en: "Cairo · Fifth Settlement" },
    description: {
      ar: "تنفيذ التشطيب الكامل للفيلا، بما يشمل الدهانات والديكورات الداخلية.",
      en: "Completed the villa finishing, including paintwork and interior detailing.",
    },
    cover: "/assets/installer-dashboard/jobs/interior-painting.png",
    thumbnails: [
      "/assets/installer-dashboard/jobs/interior-painting.png",
      "/assets/installer-dashboard/jobs/gypsum-ceiling.png",
      "/assets/installer-dashboard/jobs/marble-alt.jpg",
    ],
    extraCount: 4,
  },
] as const;

export const COVERAGE_AREAS = [
  { ar: "القاهرة", en: "Cairo" },
  { ar: "الجيزة", en: "Giza" },
  { ar: "القليوبية", en: "Qalyubia" },
] as const;

export const QUICK_TIPS = [
  { ar: "أضف صورة واضحة لمشاريعك", en: "Add clear photos of your projects" },
  { ar: "اكتب نبذة مختصرة عن كل مشروع", en: "Write a short summary for each project" },
  { ar: "اختر تخصصات دقيقة", en: "Choose precise specialties" },
  { ar: "كلما زادت التفاصيل زادت فرصك", en: "More detail improves your opportunities" },
] as const;
