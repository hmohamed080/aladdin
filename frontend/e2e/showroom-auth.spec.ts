import { z } from "zod";
import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const acceptanceEnvFile = process.env.SHOWROOM_ACCEPTANCE_ENV_FILE;
if (!acceptanceEnvFile) throw Error("Provide the approved isolated acceptance environment file; shared .env.local is never used");
const localEnv = Object.fromEntries(readFileSync(acceptanceEnvFile, "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
if (localEnv.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:65521")
    throw Error("Showroom E2E requires its dedicated local stack on 65521");
const local = z.object({ NEXT_PUBLIC_SUPABASE_URL: z.literal("http://127.0.0.1:65521"), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1) }).parse(localEnv);
const admin = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const password = "green-tiles-on-roof";
const createdUsers: string[] = [];
// Real admin guards must stay enabled. Keep synthetic reviewer role records
// until this disposable stack is destroyed; revoke their Auth access instead.
const reviewerFixtures = new Set<string>();
const screenshotDir = resolve(process.env.SHOWROOM_ACCEPTANCE_SCREENSHOT_DIR ?? "../docs/frontend/screenshots/showroom-auth");
const acceptanceContainer = process.env.GITHUB_ACTIONS === "true"
    ? "supabase_db_aladdin_pr84_ci" : "supabase_db_aladdin_pr84_acceptance";
if (process.env.SHOWROOM_ACCEPTANCE_CONTAINER && process.env.SHOWROOM_ACCEPTANCE_CONTAINER !== acceptanceContainer)
    throw Error("Refuse an unapproved acceptance database container");
mkdirSync(screenshotDir, { recursive: true });
async function clearLocalBuckets() {
    const { execFileSync } = await import("node:child_process");
    execFileSync("docker", ["exec", acceptanceContainer, "psql", "-U", "postgres", "-d", "postgres", "-c", "delete from app.phone_auth_attempts"], { stdio: "pipe", timeout: 30000 });
}
async function createPhoneAccount(kind: "showroom" | "installer", phone: string) {
    const email = "p" + phone.replace("+", "") + "@craftsman-login.aladdin.invalid";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Local showroom test" }, app_metadata: { registration_source: kind === "showroom" ? "temporary_showroom_password_flow" : "temporary_craftsman_password_flow" } });
    if (error || !data.user)
        throw Error("Local synthetic account creation failed");
    createdUsers.push(data.user.id);
    const caller = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await caller.auth.signInWithPassword({ email, password });
    if (login.error)
        throw login.error;
    for (const [name, args] of [
        ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
        ["onboarding_select_account_type", { p_track: kind === "showroom" ? "business" : "professional", p_account_type: kind === "showroom" ? "showroom_dealer" : "installer_technician" }],
        ["profile_set_phone", { p_country_iso2: "EG", p_national: phone.slice(3), p_e164: phone }],
        ["profile_set_username", { p_username: kind + "." + Math.random().toString(36).slice(2, 10) }],
    ] as const) {
        const response = await caller.rpc(name, args);
        if (response.error)
            throw response.error;
    }
    await caller.auth.signOut();
    return data.user.id;
}
test.beforeEach(async ({ page }) => {
    await clearLocalBuckets();
    // Fixture the third-party widget only. The server still calls actual Cloudflare
    // Siteverify with its documented always-pass LOCAL test secret.
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", route => route.fulfill({ contentType: "application/javascript", body: 'window.turnstile={render:function(el,options){setTimeout(function(){options.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){}};' }));
});
test.afterAll(async () => { for (const id of createdUsers) {
    if (reviewerFixtures.has(id)) {
      expect((await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" })).error).toBeNull();
      continue;
    }
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) {
      // Business/audit history may retain creator references. Quarantine ONLY
      // this synthetic local fixture instead of deleting history or changing guards.
      const banned = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
      expect(banned.error).toBeNull();
      const {execFileSync}=await import("node:child_process");
      const fixtureId=z.string().uuid().parse(id);
      execFileSync("docker",["exec",acceptanceContainer,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-c","update public.users set status='deactivated' where id='"+fixtureId+"'; update public.organizations set status='archived',deleted_at=now() where created_by='"+fixtureId+"';"],{stdio:"pipe",timeout:30000});
    }
} });
test("desktop/mobile layout, accessible controls and source assets", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of ["sign-in", "sign-up"]) {
        await page.goto("/showroom/" + route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('input[type="tel"]')).toHaveAttribute("autocomplete", "tel-national");
        await expect(page.locator('input[name="country"]')).toHaveValue("EG");
        const cta = await page.locator('button[type="submit"]').evaluate(button => {
            const style = getComputedStyle(button);
            const luminance = (color: string) => {
                const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255);
                const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                return linear.reduce((total, value, index) => total + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
            };
            const a = luminance(style.color), b = luminance(style.backgroundColor);
            return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
        });
        expect(cta.weight).toBeGreaterThanOrEqual(700);
        expect(cta.size).toBeGreaterThanOrEqual(18.67);
        expect(cta.ratio).toBeGreaterThanOrEqual(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.getByRole("link", { name: route === "sign-in" ? "إنشاء حساب" : "تسجيل الدخول", exact: true })).toBeVisible();
        await page.screenshot({ path: resolve(screenshotDir, route + "-" + info.project.name + ".png"), fullPage: true });
    }
    expect(errors).toEqual([]);
});
test("password visibility, confirmation and consent validation", async ({ page }) => {
    await page.goto("/showroom/sign-up");
    await page.getByLabel("الاسم", { exact: true }).fill("Local Test");
    await page.locator('input[name="phone"]').fill("01093817654");
    await page.locator('#password').fill(password);
    await page.locator('#confirmPassword').fill("different-password");
    await page.getByRole("button", { name: "إظهار كلمة المرور" }).first().click();
    await expect(page.locator('#password')).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "إنشاء حساب", exact: false }).click();
    await expect(page.getByText("كلمتا المرور غير متطابقتين.")).toBeVisible();
    await expect(page.getByText("من فضلك وافق على الشروط وسياسة الخصوصية")).toBeVisible();
});
test("country selection changes the numbering plan", async ({ page }) => {
    await page.goto("/showroom/sign-in");
    await page.locator('button[aria-haspopup="listbox"]').click();
    const search = page.getByRole("textbox", { name: "ابحث عن دولة" });
    await search.fill("US");
    await page.getByRole("option", { name: /\+1/ }).click();
    await page.locator('input[name="phone"]').fill("2025550123");
    await expect(page.locator('input[name="country"]')).toHaveValue("US");
    await expect(page.locator('input[name="phone"]')).not.toHaveAttribute("aria-invalid", "true");
    await page.locator('input[name="phone"]').fill("01012345678");
    await expect(page.locator('input[name="phone"]')).toHaveAttribute("aria-invalid", "true");
});
test("real registration creates only intent and an unverified phone", async ({ page }, info) => {
    const phone = "+20109" + String(Date.now()).slice(-7);
    const national = "0" + phone.slice(3);
    await page.goto("/showroom/sign-up");
    await page.getByLabel("الاسم", { exact: true }).fill("Local Showroom Test");
    await page.locator('input[name="phone"]').fill(national);
    await page.locator('#password').fill(password);
    await page.locator('#confirmPassword').fill(password);
    await page.locator('input[type="checkbox"]').check();
    await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("");
    await page.getByRole("button", { name: "إنشاء حساب", exact: false }).click();
    await expect(page).toHaveURL(/\/onboarding\/business/);
    const profile = await admin.from("profiles").select("user_id").eq("phone_e164", phone).single();
    expect(profile.error).toBeNull();
    const id = profile.data!.user_id;
    createdUsers.push(id);
    const authUser = await admin.auth.admin.getUserById(id);
    expect(authUser.data.user?.phone_confirmed_at).toBeFalsy();
    expect(authUser.data.user?.app_metadata.registration_source).toBe("temporary_showroom_password_flow");
    const state = await admin.from("users").select("status,primary_account_type").eq("id", id).single();
    expect(state.data).toEqual({ status: "pending_verification", primary_account_type: null });
    const memberships = await admin.from("memberships").select("id").eq("user_id", id);
    expect(memberships.data).toEqual([]);
    expect((await page.context().cookies()).some(cookie => cookie.name.startsWith("sb-") && cookie.value.length > 0)).toBe(true);
    await page.context().clearCookies();
    await page.goto("/showroom/sign-in");
    await page.locator('input[name="phone"]').fill(national);
    await page.locator('#password').fill(password);
    await page.getByRole("button", { name: "تسجيل الدخول", exact: false }).click();
    await expect(page).toHaveURL(/\/onboarding\/business/);
    await page.context().clearCookies();
    await page.goto("/showroom/sign-up");
    await page.getByLabel("الاسم", { exact: true }).fill("Duplicate Test");
    await page.locator('input[name="phone"]').fill(national);
    await page.locator('#password').fill(password);
    await page.locator('#confirmPassword').fill(password);
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "إنشاء حساب", exact: false }).click();
    await expect(page.getByText("يوجد حساب مسجل بالفعل بهذا الرقم")).toBeVisible();
    void info;
});
test("generic invalid login, route guards and cross-account denial", async ({ page }) => {
    const phone = "+20106" + String(Date.now()).slice(-7);
    await createPhoneAccount("installer", phone);
    await page.goto("/showroom/sign-in");
    await page.locator('input[name="phone"]').fill("0" + phone.slice(3));
    await page.locator('#password').fill(password);
    await page.getByRole("button", { name: "تسجيل الدخول", exact: false }).click();
    await expect(page.getByText("رقم الهاتف أو كلمة المرور غير صحيحة. تحقق منهما وحاول مجددًا.")).toBeVisible();
    expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("sb-") && cookie.value)).toEqual([]);
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await page.goto("/installer/sign-in");
    await page.locator('input[name="phone"]').fill("0" + phone.slice(3));
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "تسجيل الدخول", exact: false }).click();
    await expect(page).toHaveURL(/\/home/);
});
test("real per-account throttle stops repeated credential attempts", async ({ page }) => {
    await page.goto("/showroom/sign-in");
    await page.locator('input[name="phone"]').fill("01093817991");
    await page.locator('#password').fill("wrong-password");
    for (let i = 0; i < 11; i++) {
        await page.locator('#password').fill("wrong-password");
        const completed = page.waitForResponse(response => response.url().endsWith("/sign-in") && response.request().method() === "POST");
        await page.getByRole("button", { name: "تسجيل الدخول", exact: false }).click();
        // RSC can keep a response stream open after the action result is applied.
        // Assert the HTTP response, settled form and cleared password instead.
        expect([200, 429]).toContain((await completed).status());
        await expect(page.locator('form[aria-busy="false"]')).toBeVisible();
        await expect(page.locator('#password')).toHaveValue("");
        await expect(page.getByText(i < 10
            ? "رقم الهاتف أو كلمة المرور غير صحيحة. تحقق منهما وحاول مجددًا."
            : "محاولات كثيرة جدًا. انتظر لحظة وحاول مجددًا.")).toBeVisible();
    }
    await expect(page.getByText("محاولات كثيرة جدًا. انتظر لحظة وحاول مجددًا.")).toBeVisible();
    const { execFileSync } = await import("node:child_process");
    const attempts = execFileSync("docker", ["exec", acceptanceContainer, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", "select max(attempts) from app.phone_auth_attempts where action='sign-in' and subject='phone'"], { encoding: "utf8", timeout: 30000 }).trim();
    expect(attempts).toBe("11");
});
test("transport cap rejects direct oversized requests", async ({ request }) => {
    const oversized = await request.post("/sign-in", { data: "x".repeat(70000), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(oversized.status()).toBe(413);
});

test("real Installer signup remains compatible", async ({ page }) => {
  const phone = "+20108" + String(Date.now()).slice(-7);
  await page.goto("/installer/sign-up");
  await page.locator('input[name="name"]').fill("Local Installer Test");
  await page.locator('input[name="phone"]').fill("0" + phone.slice(3));
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[type="checkbox"]').check();
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("");
  await page.getByRole("button", {name:"إنشاء الحساب", exact: false}).click();
  await expect(page).toHaveURL(/\/home/);
  const profile = await admin.from("profiles").select("user_id").eq("phone_e164",phone).single();
  expect(profile.error).toBeNull(); createdUsers.push(profile.data!.user_id);
});

test("real registration failure rolls back audited identity and can be retried", async ({page}) => {
  const {execFileSync} = await import("node:child_process");
  const sql = (statement:string) => execFileSync("docker", ["exec",acceptanceContainer,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-c",statement],{stdio:"pipe",timeout:30000});
  const phone = "+20107" + String(Date.now()).slice(-7);
  const alias = "p"+phone.slice(1)+"@craftsman-login.aladdin.invalid";
  sql("create or replace function app.showroom_test_phone_failure() returns trigger language plpgsql as $$ begin raise exception 'isolated test failure' using errcode='22023'; end; $$; create trigger showroom_test_phone_failure before update of phone_e164 on public.profiles for each row when (new.phone_e164='"+phone+"') execute function app.showroom_test_phone_failure();");
  try {
    await page.goto("/showroom/sign-up");
    await page.getByLabel("الاسم",{exact:true}).fill("Local Failure Test");
    await page.locator('input[name="phone"]').fill("0"+phone.slice(3));
    await page.locator('#password').fill(password); await page.locator('#confirmPassword').fill(password);
    await page.locator('input[type="checkbox"]').check();
    await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("");
    await page.getByRole("button",{name:"إنشاء حساب",exact:false}).click();
    await expect(page.locator('form [role="alert"]')).toContainText("تعذّر إنشاء حسابك");
    const users = await admin.auth.admin.listUsers({perPage:1000});
    expect(users.data.users.find(user => user.email === alias)).toBeUndefined();
    expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("sb-") && cookie.value)).toEqual([]);
  } finally { sql("drop trigger if exists showroom_test_phone_failure on public.profiles; drop function if exists app.showroom_test_phone_failure();"); }
  await page.locator('#password').fill(password); await page.locator('#confirmPassword').fill(password);
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("");
  await page.getByRole("button",{name:"إنشاء حساب",exact:false}).click();
  await expect(page).toHaveURL(/\/onboarding\/business/);
  const profile = await admin.from("profiles").select("user_id").eq("phone_e164",phone).single();
  expect(profile.error).toBeNull(); createdUsers.push(profile.data!.user_id);
});

test("dark theme and keyboard controls retain the same functionality", async ({page,context}) => {
  await context.addCookies([{name:"aladdin-theme",value:"dark",url:"http://127.0.0.1:3342"}]);
  await page.goto("/showroom/sign-in");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Tab"); await expect(page.locator('button[aria-haspopup="listbox"]')).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.locator('input[name="phone"]')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("local provider enforces the 72 UTF-8 byte contract and stores bcrypt", async () => {
 const {execFileSync} = await import("node:child_process");
 for(const value of ["z".repeat(73), "ب".repeat(37), "😀".repeat(19)]) {
  const rejected=await admin.auth.admin.createUser({email:"oversized-local-"+Date.now()+"@example.test",password:value,email_confirm:true});
  expect(rejected.error).toBeTruthy(); expect(rejected.data.user).toBeNull();
 }
 const value="حروف عربية وكلمات آمنة "+"🪴";
 const created=await admin.auth.admin.createUser({email:"unicode-local-"+Date.now()+"@example.test",password:value,email_confirm:true});
 expect(created.error).toBeNull();createdUsers.push(created.data.user!.id);
 const caller=createClient(local.NEXT_PUBLIC_SUPABASE_URL,local.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await caller.auth.signInWithPassword({email:created.data.user!.email!,password:value})).error).toBeNull();
 const algorithm=execFileSync("docker",["exec",acceptanceContainer,"psql","-U","postgres","-d","postgres","-tA","-c","select case when left(encrypted_password,2)='$2' then 'bcrypt' else 'other' end from auth.users where id='"+created.data.user!.id+"'"],{encoding:"utf8",timeout:30000}).trim();
 expect(algorithm).toBe("bcrypt"); await caller.auth.signOut();
});


test("complete showroom journey: optional address, admin activation and seller authorization", async ({ page }, info) => {
 test.setTimeout(120000);
 const {execFileSync}=await import("node:child_process");
 const {randomUUID}=await import("node:crypto");
 const sql=(statement:string)=>execFileSync("docker",["exec",acceptanceContainer,"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-c",statement],{stdio:"pipe",timeout:30000});
 const national="0108"+String(Date.now()).slice(-7), phone="+20"+national.slice(1);
 await page.goto("/showroom/sign-up");
 await page.locator('#name').fill("Local Business Journey");
 await page.locator('input[name="phone"]').fill(national);
 await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);
 await page.locator('input[type="checkbox"]').check();await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("");
 await page.getByRole("button",{name:"إنشاء حساب",exact:false}).click();await expect(page).toHaveURL(/\/onboarding\/business/);
 const profile=await admin.from("profiles").select("user_id").eq("phone_e164",phone).single();expect(profile.error).toBeNull();const uid=z.string().uuid().parse(profile.data!.user_id);createdUsers.push(uid);
 await page.locator('#bname').fill("معرض الاختبار المحلي");await page.locator('#blegal').fill("شركة الاختبار المحلية");
 await expect(page.getByRole("button",{name:"متابعة",exact:true})).toBeDisabled();
 await page.locator('#bactivity').selectOption("paint_showroom");
 await expect(page.getByRole("button",{name:"متابعة",exact:true})).toBeDisabled();
 await page.locator('#bphone').fill("01012345678");await page.locator('#bemail').fill(" Contact@Example.test ");
 await page.getByRole("button",{name:"متابعة",exact:true}).click();await expect(page.locator('#bgov')).toBeVisible();await page.reload();
 await page.getByRole("button",{name:"رجوع",exact:true}).click();
 await expect(page.locator('#bname')).toHaveValue("معرض الاختبار المحلي");
 await expect(page.locator('#bactivity')).toHaveValue("paint_showroom");
 await page.locator('#bname').fill("معرض الاختبار المعدل");
 await page.getByRole("button",{name:"متابعة",exact:true}).click();
 await expect(page.getByRole("button",{name:"متابعة",exact:true})).toBeDisabled();
 await page.locator('#bgov').selectOption("cairo");
 await expect(page.getByRole("button",{name:"متابعة",exact:true})).toBeDisabled();
 await page.locator('#bcity').selectOption("maadi");await expect(page.locator('#baddress')).toHaveValue("");
 await page.getByRole("button",{name:"متابعة",exact:true}).click();await page.getByRole("button",{name:"متابعة",exact:true}).click();await page.getByRole("button",{name:"إرسال للمراجعة",exact:true}).click();await expect(page).toHaveURL(/\/showroom\/home$/);
 const owned=await admin.from("organizations").select("id,status,is_verified,contact_phone,contact_email").eq("created_by",uid).single();expect(owned.error).toBeNull();const orgId=z.string().uuid().parse(owned.data!.id);expect(owned.data).toMatchObject({status:"pending_verification",is_verified:false,contact_phone:"+201012345678",contact_email:"contact@example.test"});
 const branch=await admin.from("branches").select("id,address_ar,governorate_key,city_key").eq("organization_id",orgId).single();expect(branch.data).toMatchObject({address_ar:null,governorate_key:"cairo",city_key:"maadi"});
 const cookieJar=await page.context().cookies();
 const caller=createServerClient(local.NEXT_PUBLIC_SUPABASE_URL,local.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>cookieJar.map(({name,value})=>({name,value})),setAll:()=>{}}});
 expect((await caller.auth.getUser()).data.user?.id).toBe(uid);
 expect((await caller.from("organizations").update({status:"active",is_verified:true}).eq("id",orgId)).error?.code).toBe("42501");
 const product=await caller.rpc("create_product",{p_org_id:orgId,p_name:"Local product draft",p_category:"finishing",p_unit:"piece"});expect(product.error).toBeNull();const productId=z.string().uuid().parse(product.data);
 expect((await caller.rpc("set_product_published",{p_product_id:productId,p_published:true,p_expected_version:1})).error?.code).toBe("42501");
 const adminEmail="reviewer-"+randomUUID()+"@example.test";
 const reviewerUser=await admin.auth.admin.createUser({email:adminEmail,password,email_confirm:true});expect(reviewerUser.error).toBeNull();const reviewerId=z.string().uuid().parse(reviewerUser.data.user?.id);createdUsers.push(reviewerId);reviewerFixtures.add(reviewerId);
 sql("update public.users set status='active' where id='"+reviewerId+"'; insert into public.admin_role_assignments(user_id,role_id) select '"+reviewerId+"',id from public.admin_roles where key='super_admin';");
 const reviewer=createClient(local.NEXT_PUBLIC_SUPABASE_URL,local.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});expect((await reviewer.auth.signInWithPassword({email:adminEmail,password})).error).toBeNull();
 // Showroom application model: submitting the wizard already opened this organization's review, so the spec reviews THAT row.
 const openReview=await admin.from("verifications").select("id").eq("organization_id",orgId).eq("verification_type","organization").eq("status","submitted").single();expect(openReview.error).toBeNull();const verificationId=z.string().uuid().parse(openReview.data!.id);
 expect((await caller.rpc("apply_organization_verification",{p_verification_id:verificationId})).error?.code).toBe("42501");
 expect((await reviewer.rpc("review_start",{p_verification_id:verificationId})).error).toBeNull();
 expect((await reviewer.rpc("review_approve",{p_verification_id:verificationId,p_grant_public_listing:false})).error?.code).toBe("22023");
 await page.goto("/showroom/settings?section=branches");await page.waitForLoadState("networkidle");await page.getByRole("button",{name:"تعديل",exact:true}).first().click();await page.locator('#branch-address-ar').fill("١٠ شارع المعرض — المعادي، القاهرة");await page.getByRole("button",{name:"حفظ التغييرات",exact:true}).click();
 await expect.poll(async()=> (await admin.from("branches").select("address_ar").eq("id",branch.data!.id).single()).data?.address_ar).toBe("١٠ شارع المعرض — المعادي، القاهرة");
 expect((await admin.from("organizations").select("status,is_verified").eq("id",orgId).single()).data).toEqual({status:"pending_verification",is_verified:false});
 expect((await caller.rpc("set_product_published",{p_product_id:productId,p_published:true,p_expected_version:1})).error?.code).toBe("42501");
 expect((await reviewer.rpc("review_approve",{p_verification_id:verificationId,p_grant_public_listing:false})).error).toBeNull();expect((await reviewer.rpc("apply_organization_verification",{p_verification_id:verificationId})).error).toBeNull();
 expect((await caller.rpc("product_audiences_set",{p_product_id:productId,p_audiences:["supplier"]})).error).toBeNull();expect((await caller.rpc("set_product_published",{p_product_id:productId,p_published:true,p_expected_version:1})).error).toBeNull();
 expect((await admin.from("organizations").select("status,is_verified").eq("id",orgId).single()).data).toEqual({status:"active",is_verified:true});
 expect((await admin.from("profiles").select("phone_e164").eq("user_id",uid).single()).data?.phone_e164).toBe(phone);
 await reviewer.auth.signOut();
 await page.screenshot({path:resolve(screenshotDir,"business-settings-"+info.project.name+".png"),fullPage:true});
});
