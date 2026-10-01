import type { ComponentType } from "react";
import {
  BadgeCheckIcon,
  ClipboardIcon,
  MegaphoneIcon,
  ScrollIcon,
  StarOutlineIcon,
  StorefrontIcon,
  UsersIcon,
} from "@/components/ui/icons";

export type LocalizedText = { ar: string; en: string };

type ItemBase = {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

export type PointSource = ItemBase & { points: number };
export type PointsActivityId = "showroom-added" | "work-verified" | "positive-review" | "course-completed" | "peer-guidance";
export type PointsHistoryItem = ItemBase & {
  activityId: PointsActivityId;
  date: LocalizedText;
  month: "2025-03" | "2025-02";
  points: number;
};
export type PreviewReward = ItemBase & { cost: number };

/** Preview-only design fixtures. Production currently persists only its append-only points ledger and approved referral event. */
export const POINT_SOURCES: PointSource[] = [
  { id: "showroom-added", title: { ar: "إضافة معرض", en: "Add a showroom" }, points: 200, description: { ar: "احصل على 200 نقطة عند إضافة معرض جديد لأعمالك في المنصة.", en: "Earn 200 points when you add a new showroom to your work network." }, Icon: StorefrontIcon },
  { id: "work-verified", title: { ar: "إثبات انتهاء الشغل", en: "Verify completed work" }, points: 150, description: { ar: "احصل على 150 نقطة عند توثيق انتهاء مشروع بشكل كامل.", en: "Earn 150 points when a completed project is fully documented." }, Icon: ClipboardIcon },
  { id: "positive-review", title: { ar: "التقييم", en: "Customer rating" }, points: 50, description: { ar: "احصل على 50 نقطة لكل تقييم إيجابي من عميل.", en: "Earn 50 points for every positive customer rating." }, Icon: StarOutlineIcon },
  { id: "course-completed", title: { ar: "الدورات", en: "Training courses" }, points: 100, description: { ar: "احصل على 100 نقطة عند إكمال أي دورة تدريبية في المنصة.", en: "Earn 100 points when you complete a training course." }, Icon: ScrollIcon },
  { id: "peer-guidance", title: { ar: "إرشاد زميل", en: "Refer a colleague" }, points: 100, description: { ar: "احصل على 100 نقطة عند مساعدة زميل جديد في المنصة.", en: "Earn 100 points when you help a new colleague join the platform." }, Icon: UsersIcon },
];

export const POINTS_HISTORY: PointsHistoryItem[] = [
  { id: "history-showroom-mar-12", activityId: "showroom-added", title: { ar: "إضافة معرض", en: "Showroom added" }, description: { ar: "تمت إضافة معرض جديد لأعمالك في المنصة", en: "A new showroom was added to your work network" }, date: { ar: "12 مارس 2025", en: "12 Mar 2025" }, month: "2025-03", points: 200, Icon: StorefrontIcon },
  { id: "history-work-mar-10", activityId: "work-verified", title: { ar: "إثبات انتهاء الشغل", en: "Completed work verified" }, description: { ar: "تم توثيق انتهاء مشروع بشكل كامل", en: "A completed project was fully documented" }, date: { ar: "10 مارس 2025", en: "10 Mar 2025" }, month: "2025-03", points: 150, Icon: ClipboardIcon },
  { id: "history-rating-mar-08", activityId: "positive-review", title: { ar: "التقييم", en: "Customer rating" }, description: { ar: "حصلت على تقييم إيجابي من عميل", en: "You received a positive customer rating" }, date: { ar: "8 مارس 2025", en: "8 Mar 2025" }, month: "2025-03", points: 50, Icon: StarOutlineIcon },
  { id: "history-course-mar-05", activityId: "course-completed", title: { ar: "الدورات", en: "Training courses" }, description: { ar: "تم إكمال دورة أساسيات الديكور", en: "You completed the interior basics course" }, date: { ar: "5 مارس 2025", en: "5 Mar 2025" }, month: "2025-03", points: 100, Icon: ScrollIcon },
  { id: "history-peer-mar-02", activityId: "peer-guidance", title: { ar: "إرشاد زميل", en: "Colleague referral" }, description: { ar: "تمت دعوة زميل جديد للمنصة", en: "A new colleague joined through your invitation" }, date: { ar: "2 مارس 2025", en: "2 Mar 2025" }, month: "2025-03", points: 100, Icon: UsersIcon },
  { id: "history-rating-feb-28", activityId: "positive-review", title: { ar: "التقييم", en: "Customer rating" }, description: { ar: "حصلت على تقييم إيجابي من عميل", en: "You received a positive customer rating" }, date: { ar: "28 فبراير 2025", en: "28 Feb 2025" }, month: "2025-02", points: 50, Icon: StarOutlineIcon },
  { id: "history-showroom-feb-25", activityId: "showroom-added", title: { ar: "إضافة معرض", en: "Showroom added" }, description: { ar: "تمت إضافة معرض جديد لأعمالك في المنصة", en: "A new showroom was added to your work network" }, date: { ar: "25 فبراير 2025", en: "25 Feb 2025" }, month: "2025-02", points: 200, Icon: StorefrontIcon },
  { id: "history-work-feb-20", activityId: "work-verified", title: { ar: "إثبات انتهاء الشغل", en: "Completed work verified" }, description: { ar: "تم توثيق انتهاء مشروع بشكل كامل", en: "A completed project was fully documented" }, date: { ar: "20 فبراير 2025", en: "20 Feb 2025" }, month: "2025-02", points: 150, Icon: ClipboardIcon },
  { id: "history-rating-feb-15", activityId: "positive-review", title: { ar: "التقييم", en: "Customer rating" }, description: { ar: "حصلت على تقييم إيجابي من عميل", en: "You received a positive customer rating" }, date: { ar: "15 فبراير 2025", en: "15 Feb 2025" }, month: "2025-02", points: 50, Icon: StarOutlineIcon },
  { id: "history-course-feb-10", activityId: "course-completed", title: { ar: "الدورات", en: "Training courses" }, description: { ar: "تم إكمال دورة متقدمة في التشطيبات", en: "You completed an advanced finishing course" }, date: { ar: "10 فبراير 2025", en: "10 Feb 2025" }, month: "2025-02", points: 100, Icon: ScrollIcon },
];

export const RECENT_POINTS = POINTS_HISTORY.slice(0, 5);

export const PREVIEW_REWARDS: PreviewReward[] = [
  { id: "discount", title: { ar: "قسيمة خصم", en: "Discount voucher" }, description: { ar: "احصل على خصم 25% على رسوم أي خدمة مدفوعة في المنصة.", en: "Get 25% off the fee for any paid platform service." }, cost: 250, Icon: BadgeCheckIcon },
  { id: "profile-promotion", title: { ar: "ترويج ملفك الشخصي", en: "Profile promotion" }, description: { ar: "اجعل ملفك يظهر لمدة أسبوع في نتائج البحث بشكل أكبر.", en: "Boost your profile in search results for one week." }, cost: 300, Icon: MegaphoneIcon },
  { id: "certificate", title: { ar: "شهادة إنجاز معتمدة", en: "Achievement certificate" }, description: { ar: "احصل على شهادة رقمية معتمدة من منصة علاء الدين.", en: "Receive a verified digital certificate from Aladdin." }, cost: 500, Icon: BadgeCheckIcon },
];
