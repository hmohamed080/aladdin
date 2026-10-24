import "server-only";
import { readPublicEnv } from "@/lib/env";
import type { Locale } from "@/lib/i18n/locales";

/** Explicitly approved local visual data; never enabled by a URL parameter. */
export function publicPortfolioSamplesEnabled(profileId: string, host: string) {
  const env = readPublicEnv();
  return env.NEXT_PUBLIC_APP_ENV === "local"
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)
    && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    && profileId === "63fdd659-36a2-473f-9db2-4d163a2373a5";
}

export function portfolioSampleContent(locale: Locale) {
  const ar = locale === "ar";
  return {
    name: ar ? "أحمد محمود" : "Ahmed Mahmoud",
    headline: ar ? "مهندس معماري ومصمم داخلي" : "Architect & interior designer",
    bio: ar ? "أنا أحمد محمود، مهندس معماري ومصمم داخلي متخصص في تصميم المساحات السكنية والتجارية. أؤمن بأن التصميم الجيد يجمع بين الجمال والوظيفة، وأسعى دائماً لتقديم حلول مبتكرة تناسب احتياجات العملاء، وتحقق أعلى مستويات الجودة في التنفيذ." : "I’m Ahmed Mahmoud, an architect and interior designer specializing in residential and commercial spaces. I bring beauty and purpose together through considered materials, thoughtful planning and an attentive approach to every detail.",
    specialties: ar ? ["التصميم السكني", "التصميم التجاري", "التصميم الداخلي", "التصميم المعماري"] : ["Residential design", "Commercial design", "Interior design", "Architecture"],
    services: ar ? ["الإشراف على التنفيذ", "مخططات تنفيذية", "تصميم داخلي", "تصميم معماري", "إدارة المشاريع"] : ["Site supervision", "Construction drawings", "Interior design", "Architectural design", "Project management"],
    projects: (ar ? ["تصميم مطعم", "مكتب شركة", "شقة عائلية", "فيلا حديثة"] : ["Restaurant design", "Company workspace", "Family apartment", "Modern villa"]).map((title, i) => ({id: `sample-${i}`, title, description: (ar ? ["التجمع الخامس", "مصر الجديدة", "الشيخ زايد", "القاهرة الجديدة"] : ["New Cairo", "Heliopolis", "Sheikh Zayed", "New Cairo"])[i]!, category: (ar ? ["مطعم", "مكتب إداري", "شقة سكنية", "فيلا سكنية"] : ["Restaurant", "Office", "Apartment", "Villa"])[i]!, photo: [3, 2, 0, 1][i]!, count: [7, 5, 6, 8][i]!})),
    reviews: (ar ? ["نادية حسن", "خالد ياسين", "سارة أحمد", "محمد علي"] : ["Nadia Hassan", "Khaled Yassin", "Sara Ahmed", "Mohamed Ali"]).map((orgName, i) => ({id: `sample-review-${i}`, rating: 5, orgName, comment: (ar ? ["بصراحة تجربة رائعة من البداية للنهاية.", "دقة في المواعيد وجودة عالية في التنفيذ.", "أفكار إبداعية وحلول عملية. شكراً على التجربة الرائعة.", "تعامل احترافي جداً والتنفيذ كان مطابق للتصميم. أنصح به بشدة."] : ["A wonderful experience from the first conversation to the final detail.", "Thoughtful execution, excellent quality and reliable timing.", "Creative ideas and practical solutions. A wonderful experience.", "Professional throughout, with results that stayed true to the design."])[i]!, jobTitle: (ar ? ["صاحبة مطعم", "صاحب مكتب إداري", "صاحبة شقة", "مالك فيلا"] : ["Restaurant owner", "Office owner", "Apartment owner", "Villa owner"])[i]!, tradeKey: "", createdAt: "2026-10-01"})),
  };
}
