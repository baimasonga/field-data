<!-- Public marketing page. Product imagery uses synthetic example data. -->
<template>
  <div id="landing">
    <header class="landing-header">
      <div class="landing-inner landing-header-row">
        <a class="landing-brand" href="#landing-hero" :aria-label="$t('brand.home')">
          <img src="../assets/images/field-data-logo.png" alt="" width="56" height="56">
          <span><strong>Field Data</strong><small>Quantix Sierra Leone</small></span>
        </a>
        <nav class="landing-nav" :aria-label="$t('navigation')">
          <a href="#landing-capabilities">{{ $t('nav.features') }}</a>
          <a href="#landing-uses">{{ $t('nav.uses') }}</a>
          <a href="#landing-faq">{{ $t('nav.faq') }}</a>
          <router-link to="/login" class="landing-sign-in">{{ $t('action.logIn') }}</router-link>
        </nav>
      </div>
    </header>

    <section id="landing-hero" class="landing-hero">
      <div class="landing-inner landing-hero-grid">
        <div class="landing-hero-copy">
          <p class="landing-eyebrow">{{ $t('hero.eyebrow') }}</p>
          <h1>{{ $t('hero.title') }}</h1>
          <p class="landing-lede">{{ $t('hero.body') }}</p>
          <div class="landing-actions">
            <a href="#landing-contact" class="landing-cta">{{ $t('hero.primary') }}<span aria-hidden="true">↗</span></a>
            <a href="#landing-capabilities" class="landing-cta-quiet">{{ $t('hero.secondary') }}<span aria-hidden="true">↓</span></a>
          </div>
          <p class="landing-hero-note">{{ $t('hero.note') }}</p>
        </div>
        <figure class="landing-product">
          <div class="landing-product-label"><span aria-hidden="true" class="landing-product-dot"></span>{{ $t('preview.label') }}</div>
          <img src="../assets/images/landing/workspace-preview.jpg" :alt="$t('preview.alt')"
            width="1360" height="930" fetchpriority="high" decoding="async">
          <figcaption>{{ $t('preview.caption') }}</figcaption>
        </figure>
      </div>
    </section>

    <section class="landing-standards" :aria-label="$t('standards.label')">
      <ul class="landing-inner">
        <li v-for="fact in standards" :key="fact"><span aria-hidden="true">✓</span>{{ fact }}</li>
      </ul>
    </section>

    <section id="landing-capabilities" class="landing-section">
      <div class="landing-inner">
        <div class="landing-section-head">
          <p class="landing-eyebrow">{{ $t('capabilities.eyebrow') }}</p>
          <h2>{{ $t('capabilities.title') }}</h2>
          <p>{{ $t('capabilities.body') }}</p>
        </div>
        <div class="landing-feature-grid">
          <article v-for="(item, i) in capabilities" :key="item.term">
            <svg class="landing-feature-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path :d="featureIcons[i]"/></svg>
            <h3>{{ item.term }}</h3>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <section id="landing-workflow" class="landing-section landing-workflow">
      <div class="landing-inner">
        <div class="landing-section-head">
          <p class="landing-eyebrow">{{ $t('steps.eyebrow') }}</p>
          <h2>{{ $t('steps.title') }}</h2>
          <p>{{ $t('steps.body') }}</p>
        </div>
        <ol class="landing-step-grid">
          <li v-for="(step, i) in steps" :key="step.term">
            <span class="landing-step-number" aria-hidden="true">0{{ i + 1 }}</span>
            <h3>{{ step.term }}</h3>
            <p>{{ step.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="landing-section landing-fieldwork">
      <div class="landing-inner landing-fieldwork-grid">
        <figure v-if="fieldPhoto">
          <img :src="fieldPhoto.src" :alt="fieldPhoto.alt" loading="lazy" decoding="async" width="800" height="600">
          <figcaption>{{ $t('field.caption') }}</figcaption>
        </figure>
        <div>
          <p class="landing-eyebrow">{{ $t('field.eyebrow') }}</p>
          <h2>{{ $t('field.title') }}</h2>
          <p>{{ $t('field.body') }}</p>
          <ul class="landing-checklist">
            <li v-for="item in fieldItems" :key="item"><span aria-hidden="true">✓</span>{{ item }}</li>
          </ul>
          <a href="#landing-faq" class="landing-text-link">{{ $t('field.link') }} <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>

    <section id="landing-uses" class="landing-section landing-uses">
      <div class="landing-inner">
        <div class="landing-section-head">
          <p class="landing-eyebrow">{{ $t('uses.eyebrow') }}</p>
          <h2>{{ $t('uses.title') }}</h2>
          <p>{{ $t('uses.body') }}</p>
        </div>
        <div class="landing-use-grid">
          <article v-for="item in uses" :key="item.term"><h3>{{ item.term }}</h3><p>{{ item.body }}</p></article>
        </div>
      </div>
    </section>

    <section id="landing-faq" class="landing-section">
      <div class="landing-inner landing-faq-grid">
        <div class="landing-section-head">
          <p class="landing-eyebrow">{{ $t('faq.eyebrow') }}</p>
          <h2>{{ $t('faq.title') }}</h2>
          <p>{{ $t('faq.body') }}</p>
          <a href="mailto:contact@quantixsl.com" class="landing-text-link">{{ $t('faq.contact') }} <span aria-hidden="true">→</span></a>
        </div>
        <div class="landing-faq-list">
          <details v-for="item in faqs" :key="item.term">
            <summary><span>{{ item.term }}</span><span class="landing-faq-toggle" aria-hidden="true"><span class="when-closed">+</span><span class="when-open">−</span></span></summary><p>{{ item.body }}</p>
          </details>
        </div>
      </div>
    </section>

    <section id="landing-contact" class="landing-contact landing-section">
      <div class="landing-inner landing-contact-grid">
        <div>
          <p class="landing-eyebrow">{{ $t('contact.eyebrow') }}</p>
          <h2>{{ $t('contact.title') }}</h2>
          <p>{{ $t('contact.body') }}</p>
          <div class="landing-actions">
            <a href="mailto:contact@quantixsl.com" class="landing-cta">{{ $t('contact.action') }}<span aria-hidden="true">↗</span></a>
            <router-link to="/login" class="landing-cta-quiet">{{ $t('action.logIn') }}</router-link>
          </div>
        </div>
        <address class="landing-contact-details">
          <strong>Quantix Sierra Leone</strong>
          <a href="mailto:contact@quantixsl.com">contact@quantixsl.com</a>
          <span>{{ $t('contact.telephone') }}</span>
          <a href="tel:+23276141009">+232 76 141 009</a>
          <a href="tel:+23276603107">+232 76 603 107</a>
        </address>
      </div>
    </section>
    <nav class="landing-resources landing-inner" :aria-label="$t('resources.label')">
      <router-link to="/catalog">{{ $t('resources.catalog') }}</router-link>
      <a href="https://docs.getodk.org" rel="noopener" target="_blank">{{ $t('resources.docs') }}</a>
      <a href="#landing-hero">{{ $t('resources.top') }} <span aria-hidden="true">↑</span></a>
    </nav>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { landingPhotos } from './landing-photos';

defineOptions({ name: 'Landing' });
const { t, tm, rt } = useI18n();
const pairs = (key, keys) => computed(() => keys.map(k => ({ term: t(`${key}.${k}.term`), body: t(`${key}.${k}.body`) })));
const capabilities = pairs('capabilities', ['a', 'b', 'c', 'd', 'e', 'f']);
const steps = pairs('steps', ['a', 'b', 'c']);
const uses = pairs('uses', ['a', 'b', 'c', 'd', 'e', 'f']);
const faqs = pairs('faq', ['a', 'b', 'c', 'd', 'e']);
const strings = key => computed(() => tm(key).map(m => rt(m)));
const standards = strings('standards.items');
const fieldItems = strings('field.items');
const files = import.meta.glob('../assets/images/landing/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });
const sourcePhoto = landingPhotos.find(photo => photo.file === 'rice-farm-survey.webp');
const fieldPhoto = sourcePhoto && files[`../assets/images/landing/${sourcePhoto.file}`]
  ? { ...sourcePhoto, src: files[`../assets/images/landing/${sourcePhoto.file}`] } : null;
const featureIcons = [
  'M4 3h12l4 4v14H4z M8 9h8 M8 13h8 M8 17h4 M16 3v4h4',
  'M7 2h10v20H7z M10 18h4 M9 6h6 M9 10h6',
  'M9 3H4v18h16V3h-5 M9 2h6v4H9z M8 13l3 3 5-6',
  'M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5',
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  'M8 12h8 M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M9 10l6-3 M9 14l6 3'
];
</script>

<style lang="scss">
.fd-public-landing #fd-main-content.container-fluid { padding: 0; margin: 0; width: 100%; max-width: none; }
.fd-public-landing .organization-footer { margin-top: 0; }
#landing {
  --accent: #0e7490;
  --accent-hover: #0b5e75;
  --text-primary: #143039;
  --text-secondary: #405760;
  --text-muted: #526a73;
  --color-canvas: #fff;
  --color-surface: #fff;
  --color-surface-subtle: #f6f9fa;
  --border-default: #c9d7dc;
  --landing-inverse-bg: #06313e;
  --landing-inverse-text: #fff;
  --landing-inverse-secondary: #c5e1e9;
  --landing-soft-bg: #e6f1f4;
  --landing-link: #094b5e;
  color: var(--text-primary);
  background: var(--color-canvas);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: break-word;
  p { text-wrap: pretty; }
  h1, h2, h3 { color: var(--text-primary); text-wrap: balance; margin-block: 0; font-weight: 700; }
  h1 { font-size: clamp(38px, 4.6vw, 64px); letter-spacing: -0.035em; line-height: 1.1; max-width: 12ch; }
  h2 { font-size: clamp(28px, 3.1vw, 40px); line-height: 1.15; letter-spacing: -0.025em; }
  h3 { font-size: 21px; line-height: 1.3; letter-spacing: -0.015em; }
  a { color: var(--landing-link); }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
  section[id] { scroll-margin-block-start: 24px; }
  figure { margin: 0; }
  img { max-width: 100%; height: auto; }
}
#landing .landing-inner { width: 100%; max-width: 1248px; margin-inline: auto; padding-inline: 32px; }
#landing .landing-header { border-bottom: 1px solid var(--border-default); background: var(--color-surface); }
#landing .landing-header-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-block: 20px; }
#landing .landing-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--text-primary); flex-shrink: 0; }
#landing .landing-brand img { width: 48px; height: 48px; object-fit: contain; }
#landing .landing-brand strong { display: block; font-size: 21px; line-height: 1.25; }
#landing .landing-brand small { display: block; font-size: 13px; color: var(--text-muted); }
#landing .landing-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
#landing .landing-nav a { display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; text-decoration: none; }
#landing .landing-nav a:hover { text-decoration: underline; text-underline-offset: 5px; }
#landing .landing-nav .landing-sign-in { border: 1px solid var(--border-default); border-radius: 8px; padding-inline: 20px; }
#landing .landing-hero { background: var(--color-surface-subtle); padding-block: 72px; }
#landing .landing-hero-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 48px; align-items: center; }
#landing .landing-eyebrow { color: var(--text-secondary); font-size: 13px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-block: 0 16px; }
#landing .landing-lede { font-size: 19px; line-height: 1.6; color: var(--text-secondary); max-width: 48ch; margin-block: 24px 0; }
#landing .landing-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 28px; }
#landing .landing-cta, #landing .landing-cta-quiet { display: inline-flex; align-items: center; justify-content: center; gap: 16px; min-height: 48px; padding: 10px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; }
#landing .landing-cta { background: var(--accent); color: var(--landing-inverse-text); border: 1px solid var(--accent); }
#landing .landing-cta:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
#landing .landing-cta-quiet { border: 1px solid var(--border-default); color: var(--landing-link); background: var(--color-surface); }
#landing .landing-cta-quiet:hover { background: var(--landing-soft-bg); }
#landing .landing-hero-note { font-size: 14px; color: var(--text-muted); margin-block: 20px 0; }
#landing .landing-product { min-width: 0; padding: 12px; border-radius: 20px; background: var(--color-surface); box-shadow: 0 12px 40px #14303914, 0 2px 8px #1430390a; }
#landing .landing-product-label { display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 600; padding: 4px 4px 12px; }
#landing .landing-product-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary); }
#landing .landing-product img { display: block; width: 100%; border-radius: 8px; outline: 1px solid #0000001a; }
#landing .landing-product figcaption { margin-block: 12px 2px; padding-inline: 4px; color: var(--text-muted); font-size: 13px; }
#landing .landing-standards { border-block: 1px solid var(--border-default); padding-block: 24px; }
#landing .landing-standards ul { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px 32px; list-style: none; margin-block: 0; }
#landing .landing-standards li { display: flex; gap: 12px; align-items: baseline; color: var(--text-secondary); font-size: 15px; }
#landing .landing-section { padding-block: 80px; }
#landing .landing-section-head { max-width: 66ch; margin-bottom: 40px; }
#landing .landing-section-head > p:last-of-type { color: var(--text-secondary); font-size: 18px; margin-block: 20px 0; }
#landing .landing-feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px 32px; }
#landing .landing-feature-grid article { min-width: 0; }
#landing .landing-feature-icon { width: 36px; height: 36px; margin-bottom: 20px; color: var(--text-secondary); }
#landing .landing-feature-grid p, #landing .landing-use-grid p, #landing .landing-step-grid p { color: var(--text-secondary); margin-block: 12px 0; max-width: 48ch; }
#landing .landing-workflow { background: var(--color-surface-subtle); }
#landing .landing-step-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px; list-style: none; padding: 0; margin: 0; }
#landing .landing-step-number { display: block; font-size: 32px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-muted); margin-bottom: 16px; }
#landing .landing-fieldwork-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 64px; align-items: center; }
#landing .landing-fieldwork img { display: block; width: 100%; border-radius: 12px; outline: 1px solid #0000001a; }
#landing .landing-fieldwork figcaption { color: var(--text-muted); font-size: 13px; margin-top: 12px; }
#landing .landing-fieldwork p:not(.landing-eyebrow) { color: var(--text-secondary); font-size: 18px; margin-block: 20px; }
#landing .landing-checklist { list-style: none; padding: 0; margin-block: 24px; }
#landing .landing-checklist li { display: flex; gap: 12px; align-items: baseline; margin-block: 12px; }
#landing .landing-text-link { display: inline-flex; gap: 8px; min-height: 44px; align-items: center; text-decoration: underline; text-underline-offset: 4px; font-weight: 600; }
#landing .landing-uses { background: var(--landing-soft-bg); }
#landing .landing-use-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
#landing .landing-use-grid article { background: var(--color-surface); border-radius: 12px; padding: 24px; min-width: 0; }
#landing .landing-faq-grid { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 64px; }
#landing .landing-faq-grid .landing-section-head { margin-bottom: 0; }
#landing .landing-faq-list details { border-bottom: 1px solid var(--border-default); }
#landing .landing-faq-list details:first-child { border-top: 1px solid var(--border-default); }
#landing .landing-faq-list summary { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-block: 20px; font-size: 18px; font-weight: 600; cursor: pointer; }
#landing .landing-faq-toggle { flex-shrink: 0; font-size: 21px; }
#landing .landing-faq-toggle .when-open, #landing details[open] .when-closed { display: none; }
#landing details[open] .when-open { display: inline; }
#landing .landing-faq-list p { color: var(--text-secondary); margin-block: 0 24px; max-width: 60ch; }
#landing .landing-contact { background: var(--landing-inverse-bg); color: var(--landing-inverse-text); }
#landing .landing-contact-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .7fr); gap: 64px; align-items: center; }
#landing .landing-contact h2 { color: var(--landing-inverse-text); }
#landing .landing-contact p:not(.landing-eyebrow) { color: var(--landing-inverse-secondary); font-size: 18px; max-width: 54ch; margin-block: 20px 0; }
#landing .landing-contact .landing-eyebrow { color: var(--landing-inverse-secondary); }
#landing .landing-contact .landing-cta { color: var(--landing-link); background: var(--color-surface); border-color: var(--color-surface); }
#landing .landing-contact .landing-cta:hover { background: var(--landing-soft-bg); border-color: var(--landing-soft-bg); }
#landing .landing-contact .landing-cta-quiet { color: var(--landing-inverse-text); background: transparent; border-color: var(--landing-inverse-secondary); }
#landing .landing-contact a:focus-visible { outline-color: var(--landing-inverse-text); }
#landing .landing-contact-details { font-style: normal; margin: 0; display: grid; justify-items: start; gap: 8px; }
#landing .landing-contact-details strong { font-size: 21px; }
#landing .landing-contact-details span { color: var(--landing-inverse-secondary); font-size: 14px; margin-top: 16px; }
#landing .landing-contact-details a { color: var(--landing-inverse-text); display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; text-underline-offset: 4px; }
#landing .landing-resources { display: flex; flex-wrap: wrap; gap: 16px 32px; padding-block: 24px; }
#landing .landing-resources a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; text-underline-offset: 4px; }
@media (max-width: 960px) {
  #landing .landing-hero-grid { gap: 32px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #landing .landing-fieldwork-grid, #landing .landing-faq-grid { gap: 32px; }
  #landing .landing-feature-grid, #landing .landing-use-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  #landing .landing-inner { padding-inline: 24px; }
  #landing .landing-header-row { flex-wrap: wrap; gap: 16px; }
  #landing .landing-nav { width: 100%; justify-content: space-between; gap: 8px 16px; }
  #landing .landing-nav .landing-sign-in { padding-inline: 16px; }
  #landing .landing-hero-grid, #landing .landing-fieldwork-grid, #landing .landing-faq-grid, #landing .landing-contact-grid { grid-template-columns: minmax(0, 1fr); }
  #landing .landing-hero { padding-block: 48px; }
  #landing .landing-section { padding-block: 56px; }
  #landing .landing-step-grid { grid-template-columns: minmax(0, 1fr); gap: 32px; }
  #landing .landing-contact-grid { gap: 32px; }
}
@media (max-width: 520px) {
  #landing .landing-inner { padding-inline: 20px; }
  #landing .landing-nav { gap: 8px; }
  #landing .landing-nav a { font-size: 14px; }
  #landing .landing-nav .landing-sign-in { padding-inline: 12px; }
  #landing .landing-feature-grid, #landing .landing-use-grid { grid-template-columns: minmax(0, 1fr); }
  #landing .landing-actions { align-items: stretch; flex-direction: column; }
  #landing .landing-product { padding: 8px; border-radius: 16px; }
  #landing .landing-hero-grid { gap: 32px; }
  #landing .landing-lede { font-size: 18px; }
  #landing .landing-contact-details a { overflow-wrap: anywhere; }
}
@media (forced-colors: active) {
  #landing a:focus-visible, #landing summary:focus-visible { outline-color: Highlight; }
  #landing .landing-cta, #landing .landing-use-grid article, #landing .landing-product { border: 1px solid ButtonText; }
}
</style>

<i18n lang="json">
{
  "en": {
    "brand": {
      "home": "Field Data home"
    },
    "navigation": "Page navigation",
    "nav": {
      "features": "Features",
      "uses": "Use cases",
      "faq": "FAQs"
    },
    "hero": {
      "eyebrow": "Fieldwork, connected",
      "title": "Better field data. Clearer decisions.",
      "body": "Design forms, collect responses and turn reviewed records into useful evidence. A shared workspace for teams working in communities, facilities and the field.",
      "primary": "Discuss your project",
      "secondary": "Explore features",
      "note": "By Quantix Sierra Leone \u00b7 Built on ODK"
    },
    "preview": {
      "label": "Inside the Field Data workspace",
      "alt": "Field Data dashboard showing submission totals, a collection trend, projects and recent responses.",
      "caption": "Actual Field Data interface, shown with example data."
    },
    "standards": {
      "label": "Collection and reporting tools",
      "items": [
        "Visual form builder and XLSForm",
        "Offline collection with ODK Collect",
        "Maps, charts and data exports"
      ]
    },
    "capabilities": {
      "eyebrow": "From form to findings",
      "title": "One workspace for the whole workflow",
      "body": "Keep form design, field teams, data review and reporting connected throughout your project.",
      "a": {
        "term": "Build the right questions",
        "body": "Create forms visually or import XLSForm. Use skip logic, validation, calculations, groups, repeats and translated labels to capture the details that matter."
      },
      "b": {
        "term": "Collect wherever work happens",
        "body": "Work offline with ODK Collect on Android, or share a browser form link. Capture locations, photos and other attachments alongside responses."
      },
      "c": {
        "term": "Review before you report",
        "body": "Flag issues, leave comments and approve or reject submissions. Use the review queue and cleaning tools to follow up on incomplete or inconsistent records."
      },
      "d": {
        "term": "See what the data is telling you",
        "body": "Explore responses in tables, maps, photos and charts. Monitor collection with dashboards and reports, then export records for further analysis."
      },
      "e": {
        "term": "Keep teams and follow-up organised",
        "body": "Manage projects, field teams, assignments and cases. Use entity lists to support repeat visits and follow the same people, facilities or assets over time."
      },
      "f": {
        "term": "Connect and share with control",
        "body": "Manage project permissions, publish approved datasets and connect reporting workflows through CSV, OData, webhooks and DHIS2 mapping."
      }
    },
    "steps": {
      "eyebrow": "A practical way to get started",
      "title": "Prepare. Collect. Put the data to work.",
      "body": "Set up the questions and people once, then keep each stage of the work in view.",
      "a": {
        "term": "Prepare your project",
        "body": "Create a project, build or import a form, set permissions and test the draft with your team."
      },
      "b": {
        "term": "Collect and coordinate",
        "body": "Distribute forms through ODK Collect or browser links. Assign fieldwork and monitor incoming responses."
      },
      "c": {
        "term": "Review, analyse and share",
        "body": "Resolve issues, approve records, explore results and export the data your programme needs."
      }
    },
    "field": {
      "eyebrow": "Designed for field conditions",
      "title": "Keep collecting when the connection drops",
      "body": "With ODK Collect, your team can complete forms on Android devices offline and upload when connectivity returns. Browser forms offer another way to collect responses online.",
      "caption": "An illustration of agricultural fieldwork.",
      "items": [
        "Prepare and download forms before a visit",
        "Capture GPS coordinates and photos in the field",
        "Submit from ODK Collect when a connection returns"
      ],
      "link": "Read about offline collection"
    },
    "uses": {
      "eyebrow": "Built around your programme",
      "title": "Different sectors. The same need for reliable data.",
      "body": "Adapt the questions and workflow to your setting, from a one-off survey to ongoing monitoring and follow-up.",
      "a": {
        "term": "Health and public services",
        "body": "Assess facility readiness, community needs and service availability. Map locations and prepare reviewed records for reporting."
      },
      "b": {
        "term": "Agriculture and livelihoods",
        "body": "Survey farms, crops, markets and household livelihoods. Document observations with photos and GPS, and organise repeat visits."
      },
      "c": {
        "term": "Education",
        "body": "Record school facilities, staffing and learning resources. Coordinate site visits and compare results across locations."
      },
      "d": {
        "term": "Development programmes",
        "body": "Run baseline and endline surveys, monitor activities and manage beneficiary follow-up in a shared team workspace."
      },
      "e": {
        "term": "Research and household surveys",
        "body": "Use structured questionnaires, validation rules and organised collection teams. Export reviewed responses for statistical analysis."
      },
      "f": {
        "term": "Infrastructure and environment",
        "body": "Document water points, public assets and environmental conditions. Keep locations and evidence together for follow-up inspections."
      }
    },
    "faq": {
      "eyebrow": "Before you get started",
      "title": "A few useful answers",
      "body": "Have a question about your programme or collection workflow? Speak with Quantix Sierra Leone.",
      "contact": "Email Quantix Sierra Leone",
      "a": {
        "term": "Can our team collect data offline?",
        "body": "Yes. ODK Collect on Android supports offline collection after forms have been downloaded. Your team submits saved responses when connectivity returns. Browser form links are also available for online collection."
      },
      "b": {
        "term": "Can we use forms we already have?",
        "body": "You can upload XLSForm spreadsheets or use the visual form builder. The advanced builder can import supported XLSForm structures. Forms with unsupported constructs can continue through the spreadsheet workflow."
      },
      "c": {
        "term": "How do we review and share the results?",
        "body": "Review submissions, comment on issues and approve or reject records. Explore results in the data views and export them for analysis. Public datasets require an explicit publication step."
      },
      "d": {
        "term": "Who can access a project's data?",
        "body": "Project permissions determine what team members can access and do. Public form links and published datasets have separate sharing controls, so your team can choose how each project is shared."
      },
      "e": {
        "term": "How do we get access or discuss a project?",
        "body": "Contact Quantix Sierra Leone at contact{'@'}quantixsl.com or call +232 76 141 009 or +232 76 603 107 to discuss your requirements. If you already have an account, use Log in to open your workspace."
      }
    },
    "contact": {
      "eyebrow": "Your next fieldwork project",
      "title": "Start with the questions you need answered",
      "body": "Tell Quantix Sierra Leone what you need to collect, where your team will work and how you plan to use the results.",
      "action": "Email Quantix Sierra Leone",
      "telephone": "Telephone"
    },
    "resources": {
      "label": "Resources",
      "catalog": "Browse the public catalogue",
      "docs": "Read ODK documentation",
      "top": "Back to top"
    }
  }
}
</i18n>
