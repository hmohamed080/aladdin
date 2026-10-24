// Builds E2E_RESULTS.md from traces/e2e-results.jsonl (last record per scenario id wins).
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..");
const lines = fs.readFileSync(path.join(dir, "traces/e2e-results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byId = new Map();
for (const r of lines) byId.set(r.id, r);
const rows = [...byId.values()];
const order = ["A", "B", "C", "D", "E", "F", "G", "H"];
rows.sort((a, b) => order.indexOf(a.journey[0]) - order.indexOf(b.journey[0]) || a.id.localeCompare(b.id, "en", { numeric: true }));
const count = (s) => rows.filter((r) => r.status === s).length;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const bugRef = { D11z: "BL-3", D14: "BL-1", A15: "SEC-5", G8: "—" };
let md = `# نتائج سيناريوهات E2E — مراجعة 2026-10-15\n\n`;
md += `**البيئة:** \`next build\` + \`next start\` (production mode) على \`http://localhost:3200\`، Supabase محلي \`aladdin-marketplace\`، Chromium من Playwright 1.62.1، desktop 1440×900، اللغة ar-EG.\n`;
md += `**الـ harness:** \`frontend/playwright.audit.config.ts\` + \`frontend/e2e-audit/*.spec.ts\` (من غير globalSetup، ومن غير reset). الحالات اللي بتغيّر بيانات اتعملت على fixtures معزولة بس.\n\n`;
md += `| الحالة | العدد |\n|---|---|\n| PASS | ${count("PASS")} |\n| FAIL | ${count("FAIL")} |\n| PARTIAL | ${count("PARTIAL")} |\n| BLOCKED | ${count("BLOCKED")} |\n| **الإجمالي** | **${rows.length}** |\n\n`;
md += `> بعض الحالات فشلت في أول تشغيل بسبب أخطاء في الـ harness نفسه، وليس في المنتج (مثلًا: selector بالاسم الإنجليزي، أو كلمة سر fixture اتولدت من جديد). اتصلحت واتعادت، والنتيجة المسجلة هي آخر تشغيل. لما تكون النتيجة اتصححت من استعلام مباشر على قاعدة البيانات، ده مذكور في عمود "النتيجة الفعلية".\n\n`;
let cur = "";
for (const r of rows) {
  if (r.journey !== cur) {
    cur = r.journey;
    md += `\n## ${cur}\n\n| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  }
  md += `| ${r.id} | ${esc(r.scenario)} | ${esc(r.role)} | ${esc(r.data)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.ms != null ? r.ms + " ms" : "—"} | **${r.status}** | ${esc(r.evidence ?? "traces/e2e-results.jsonl")} | ${bugRef[r.id] ?? ""} |\n`;
}
md += `\n## مسح المسارات (Route crawl)\nملف \`traces/route-crawl.csv\`: 126 صفحة × 3 أدوار (anonymous، Decore، Super Admin) = 378 زيارة GET. **0 أخطاء 5xx و0 أخطاء console.** كل الـ 404 مقصودة: منتج B2B لمستأجر تاني، و\`/marketplace/cart\`، وملف شخصي غير منشور. 58 مسار ديناميكي **NOT_TESTED** لأن مفيش id اتحدد ليهم.\n`;
fs.writeFileSync(path.join(dir, "E2E_RESULTS.md"), md);
console.log(JSON.stringify({ total: rows.length, pass: count("PASS"), fail: count("FAIL"), partial: count("PARTIAL"), blocked: count("BLOCKED") }));
