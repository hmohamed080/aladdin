import { FOOTER_LINKS, SOCIAL_LINKS } from "./landing-brand-links";
import Image from "next/image";
import { brandContent, PARTNER_NAMES } from "./landing-brand-content";
import { bukra, hurme } from "./landing-brand-fonts";
import { LandingBrandFaq } from "./landing-brand-faq";
import { LandingBrandHeader } from "./landing-brand-header";
import { BrandIcon, SocialIcon } from "./landing-brand-icons";
import { LandingBrandVideo } from "./landing-brand-video";
import { MobileCta, MobileExperience, MobileFooter, MobileHero, MobileHow, MobileRoles, MobileServices, MobileWhy } from "./landing-brand-mobile";
import { LandingBrandMarket } from "./landing-brand-market";
import { formatStat, type LandingStats } from "./landing-brand-stats";
import styles from "./landing-brand.module.css";

/** The public Landing page (brand identity, design-system v1.1.0). Server component; interactive parts are the header, product chips and FAQ. */
export function LandingBrand({ stats }: { stats: LandingStats }) {
  const c = brandContent;
  const pills = (
    [
      ["users", stats.users, c.hero.stats.users],
      ["building", stats.organizations, c.hero.stats.orgs],
      ["layers", stats.products, c.hero.stats.products],
    ] as const
  ).filter(([, n]) => n !== null && n > 0);

  return (
    <div id="top" className={`${styles.page} ${hurme.variable} ${bukra.variable}`}>
      <div className={styles.onlyDesktop}>
      <section className={styles.heroWrap}>
        <div className={styles.hero}>
          <Image src="/landing-brand/hero.jpg" alt="" fill priority sizes="(max-width: 1280px) 100vw, 1232px" className={styles.heroImg} />
          <div className={styles.heroShade} />
          <LandingBrandHeader />
          <div className={styles.heroBody}>
            <div className={styles.heroCopy}>
              <h1>{c.hero.title} <span>{c.hero.accent}</span> {c.hero.titleTail}</h1>
              <p>{c.hero.body}</p>
              <div className={styles.heroButtons}>
                <a className={styles.btnLight} href="#market"><BrandIcon name="grid" size={25} />{c.hero.discover}</a>
                <a className={styles.btnOutline} href="/auth/sign-up"><BrandIcon name="user-plus" size={25} />{c.hero.create}</a>
              </div>
            </div>
            <div className={styles.videoSlot}><LandingBrandVideo /></div>
            {pills.length > 0 ? (
              <ul className={styles.pills}>
                {pills.map(([icon, n, label]) => (
                  <li key={label}>
                    <span><strong>{formatStat(n as number)}</strong><small>{label}</small></span>
                    <i><BrandIcon name={icon} size={22} /></i>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileHero stats={stats} /></div>

      <div className={styles.onlyDesktop}>
      <section id="roles" className={styles.section}>
        <p className={styles.eyebrow}>{c.roles.eyebrow}</p>
        <h2>{c.roles.title}</h2>
        <div className={styles.roles}>
          {c.roles.items.map((r) => (
            <article key={r.title} className={styles.role}>
              <div className={styles.roleImg}>
                <Image src={`/landing-brand/${r.img}.jpg`} alt="" fill sizes="(max-width: 900px) 40vw, 280px" />
                <i><BrandIcon name={r.icon} size={22} /></i>
              </div>
              <div className={styles.roleBody}>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <a href="/auth/sign-up" className={styles.more}>{c.roles.more}<BrandIcon name="arrow" size={16} className={styles.flip} /></a>
              </div>
            </article>
          ))}
        </div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileRoles /></div>

      <div className={styles.onlyDesktop}>
      <section id="services" className={styles.servicesWrap}>
        <div className={styles.services}>
          <div className={styles.servicesCopy}>
            <p className={styles.eyebrow}>{c.services.eyebrow}</p>
            <h2>{c.services.title}</h2>
            <p className={styles.lead}>{c.services.body}</p>
            <ul className={styles.serviceItems}>
              {c.services.items.map((s) => (
                <li key={s.title}><BrandIcon name={s.icon} size={28} /><strong>{s.title}</strong><span>{s.body}</span></li>
              ))}
            </ul>
          </div>
          <div className={styles.servicesImg}><Image src="/landing-brand/room.jpg" alt="" fill sizes="(max-width: 900px) 100vw, 480px" /></div>
        </div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileServices /></div>

      <section id="market" className={`${styles.section} ${styles.market}`}>
        <div className={styles.marketHead}>
          <div>
            <p className={styles.eyebrow}>{c.market.eyebrow}</p>
            <h2>{c.market.title}</h2>
            <p className={styles.lead}>{c.market.body}</p>
          </div>
          <a className={styles.btnDark} href="/marketplace">{c.market.browse}<BrandIcon name="arrow" size={18} className={styles.flip} /></a>
        </div>
        <LandingBrandMarket />
      </section>

      <div className={styles.onlyDesktop}>
      <section id="how" className={`${styles.section} ${styles.how}`}>
        <div><p className={styles.eyebrow}>{c.how.eyebrow}</p><h2>{c.how.title}</h2></div>
        <ol>
          {c.how.steps.map((s, i) => (
            <li key={s.title}>
              <div><b>{i + 1}</b><BrandIcon name={s.icon} size={30} /></div>
              <strong>{s.title}</strong><span>{s.body}</span>
            </li>
          ))}
        </ol>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileHow /></div>

      <div className={styles.onlyDesktop}>
      <section id="why" className={styles.whyWrap}>
        <div className={styles.why}>
          <div><p className={styles.eyebrow}>{c.why.eyebrow}</p><h2>{c.why.title}</h2></div>
          <ul>
            {c.why.items.map((w) => (
              <li key={w.title}><BrandIcon name={w.icon} size={30} /><strong>{w.title}</strong><span>{w.body}</span></li>
            ))}
          </ul>
        </div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileWhy /></div>

      <div className={styles.onlyDesktop}>
      <section id="experience" className={`${styles.section} ${styles.experience}`}>
        <div>
          <p className={styles.eyebrow}>{c.experience.eyebrow}</p>
          <h2>{c.experience.title}</h2>
          <p className={styles.lead}>{c.experience.body}</p>
          <ul>
            {c.experience.items.map((e) => <li key={e.label}><BrandIcon name={e.icon} size={26} />{e.label}</li>)}
          </ul>
        </div>
        <div className={styles.devices}><Image src="/landing-brand/devices.jpg" alt={c.experience.alt} width={1400} height={518} sizes="(max-width: 900px) 100vw, 640px" /></div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileExperience /></div>

      <section className={styles.partnersWrap}>
        <div className={styles.partners}>
          <div><h2>{c.partners.title}</h2><p>{c.partners.body}</p></div>
          <div className={styles.marquee} aria-hidden="true">
            <div className={styles.track}>
              {[...PARTNER_NAMES, ...PARTNER_NAMES].map((n, i) => <span key={`${n}-${i}`}>{n}</span>)}
            </div>
          </div>
          <ul className={styles.srOnly}>{PARTNER_NAMES.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </section>

      <section id="faq" className={`${styles.section} ${styles.faq}`}>
        <div className={styles.faqIntro}><h2>{c.faq.title}</h2><p>{c.faq.body}</p></div>
        <div className={styles.faqImg}><Image src="/landing-brand/faqimg.jpg" alt="" fill sizes="240px" /></div>
        <LandingBrandFaq />
      </section>

      <div className={styles.onlyDesktop}>
      <section className={styles.ctaWrap}>
        <div className={styles.cta}>
          <div>
            <h2>{c.cta.title} <span>{c.cta.accent}</span></h2>
            <p>{c.cta.body}</p>
            <div className={styles.heroButtons}>
              <a className={styles.btnLight} href="#market"><BrandIcon name="grid" size={20} />{c.cta.discover}</a>
              <a className={styles.btnOutline} href="/auth/sign-up"><BrandIcon name="user-plus" size={18} />{c.cta.create}</a>
            </div>
          </div>
          <div className={styles.ctaImg}><Image src="/landing-brand/cta.jpg" alt="" fill sizes="(max-width: 900px) 100vw, 520px" /></div>
        </div>
      </section>
      </div>
      <div className={styles.onlyMobile}><MobileCta /></div>

      <div className={styles.onlyDesktop}>
      <footer id="footer" className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footBrand}>
            <a href="#top" className={styles.footLogo}><Image src="/landing-brand/mark-navy.png" alt="" width={34} height={52} /><span>علاء الدين</span></a>
            <small>{c.footer.tagline}</small>
          </div>
          <p>{c.footer.about}</p>
          {([[c.footer.quick, c.footer.quickLinks], [c.footer.platform, c.footer.platformLinks], [c.footer.support, c.footer.supportLinks]] as const).map(([title, links]) => (
            <div key={title} className={styles.footCol}><strong>{title}</strong>{links.map((l) => <a key={l} href={FOOTER_LINKS[l] ?? "#top"}>{l}</a>)}</div>
          ))}
          <div className={styles.footCol}>
            <strong>{c.footer.follow}</strong>
            <div className={styles.social}>
              {(["facebook", "tiktok"] as const).map((n) => <a key={n} href={SOCIAL_LINKS[n]} target="_blank" rel="noopener noreferrer" aria-label={n}><SocialIcon name={n} /></a>)}
            </div>
          </div>
        </div>
        <span className={styles.rights}>{c.footer.rights}</span>
      </footer>
      </div>
      <div className={styles.onlyMobile}><MobileFooter /></div>
    </div>
  );
}
