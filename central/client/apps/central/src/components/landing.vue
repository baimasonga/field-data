<!--
Public front door. An anonymous visitor arriving at the root sees this rather
than a login form; the router sends deep links straight to login as before.

Everything claimed here is something this distribution actually does. There is
no borrowed social proof: no customer names, logos, quotes or counts, because
none of it would be true.
-->
<template>
  <div id="landing">
    <section id="landing-hero">
      <div class="landing-inner">
        <div class="landing-hero-copy">
          <p class="landing-eyebrow">{{ $t('hero.eyebrow') }}</p>
          <h1>{{ $t('hero.title') }}</h1>
          <p class="landing-lede">{{ $t('hero.body') }}</p>
          <div class="landing-actions">
            <router-link to="/login" class="landing-cta">
              {{ $t('action.logIn') }}
            </router-link>
            <a href="#landing-capabilities" class="landing-cta-quiet">
              {{ $t('hero.secondary') }}
            </a>
          </div>
        </div>
</div>
    </section>

    <section id="landing-standards">
      <div class="landing-inner">
        <ul>
          <li v-for="fact in standards" :key="fact">{{ fact }}</li>
        </ul>
      </div>
    </section>

    <section id="landing-uses">
      <div class="landing-inner">
        <p class="landing-section-eyebrow">{{ $t('uses.eyebrow') }}</p>
        <h2 class="landing-section-title">{{ $t('uses.title') }}</h2>
        <p class="landing-section-intro">{{ $t('uses.body') }}</p>
        <div class="landing-capability-grid landing-use-grid">
          <article v-for="item in uses" :key="item.term">
            <h3>{{ item.term }}</h3>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <section v-if="photos.length !== 0" id="landing-field">
      <div class="landing-inner">
        <h2 class="landing-section-title">{{ $t('field.title') }}</h2>
        <ul class="landing-photo-grid">
          <li v-for="photo in photos" :key="photo.file">
            <figure>
              <img :src="photo.src" :alt="photo.alt" loading="lazy" decoding="async"
                width="800" height="600">
              <figcaption>{{ photo.caption }}</figcaption>
            </figure>
          </li>
        </ul>
      </div>
    </section>

    <section id="landing-capabilities">
      <div class="landing-inner">
        <p class="landing-section-eyebrow">{{ $t('capabilities.eyebrow') }}</p>
        <h2 class="landing-section-title">{{ $t('capabilities.title') }}</h2>
        <p class="landing-section-intro">{{ $t('capabilities.body') }}</p>
        <div class="landing-capability-grid">
          <article v-for="item in capabilities" :key="item.term">
            <h3>{{ item.term }}</h3>
            <p>{{ item.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <section id="landing-steps">
      <div class="landing-inner">
        <h2 class="landing-section-title">{{ $t('steps.title') }}</h2>
        <!-- Numbered because this genuinely is a sequence. -->
        <ol>
          <li v-for="(step, i) in steps" :key="step.term">
            <span class="landing-step-num">{{ i + 1 }}</span>
            <h3>{{ step.term }}</h3>
            <p>{{ step.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section id="landing-included">
      <div class="landing-inner">
        <h2 class="landing-section-title">{{ $t('included.title') }}</h2>
        <ul class="landing-included-grid">
          <li v-for="item in included" :key="item">{{ item }}</li>
        </ul>
      </div>
    </section>

    <section id="landing-close">
      <div class="landing-inner">
        <h2>{{ $t('close.title') }}</h2>
        <p>{{ $t('close.body') }}</p>
        <div class="landing-actions">
          <a href="mailto:contact@quantixsl.com" class="landing-cta">{{ $t('close.contact') }}</a>
          <router-link to="/login" class="landing-cta-quiet">{{ $t('action.logIn') }}</router-link>
        </div>
      </div>
    </section>

    <footer id="landing-footer">
      <div class="landing-inner landing-footer-row">
        <span class="landing-host">{{ hostname }}</span>
        <a href="https://docs.getodk.org" rel="noopener" target="_blank">
          {{ $t('footer.docs') }}
        </a>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { landingPhotos } from './landing-photos';

defineOptions({
  name: 'Landing'
});

const { t, tm, rt } = useI18n();
const { hostname } = window.location;

// Only photographs that exist on disk AND carry alt text and a caption are
// shown; anything else is dropped rather than rendered half-described.
const files = import.meta.glob('../assets/images/landing/*.{jpg,jpeg,png,webp}', {
  eager: true, query: '?url', import: 'default'
});
const photos = landingPhotos
  .map(photo => ({
    ...photo,
    src: files[`../assets/images/landing/${photo.file}`]
  }))
  .filter(photo => photo.src != null && photo.alt && photo.caption);


const pairs = (key, keys = ['a', 'b', 'c']) => computed(() => keys
  .map(k => ({ term: t(`${key}.${k}.term`), body: t(`${key}.${k}.body`) })));
const capabilities = pairs('capabilities', ['a', 'b', 'c', 'd', 'e', 'f']);
const uses = pairs('uses', ['a', 'b', 'c', 'd', 'e', 'f']);
const steps = pairs('steps');
// tm() hands back compiled message nodes, not strings; rt() resolves them.
const strings = (key) => computed(() => tm(key).map(m => rt(m)));
const standards = strings('standards.items');
const included = strings('included.items');
</script>

<style lang="scss">
#landing {
  background-color: var(--color-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

.landing-inner {
  margin-inline: auto;
  max-width: var(--container-xl);
  padding-inline: var(--space-6);
}

.landing-section-title {
  color: var(--text-primary);
  font-size: var(--text-headline);
  font-weight: 700;
  letter-spacing: var(--tracking-headline);
  margin-block: 0 var(--space-10);
  text-wrap: balance;
}

// ------------------------------------------------------------------ hero
// A dark teal overlay keeps the Field Data branding and photo legible.
#landing-hero {
  background-color: var(--gray-1000);
  background-image: url('../assets/images/landing/water-point-survey.webp');
  background-position: center 40%;
  background-size: cover;
  color: var(--gray-0);
  overflow: hidden;
  padding-block: var(--space-20) var(--space-24);
  position: relative;

  // Keep the text legible over bright areas and before the image loads.
  &::before {
    background: #06313e;
    content: '';
    inset: 0;
    opacity: 0.82;
    position: absolute;
  }

  .landing-inner { position: relative; }
}

.landing-eyebrow {
  color: #c5e1e9;
  font-size: var(--text-overline);
  font-weight: 600;
  letter-spacing: var(--tracking-overline);
  margin-block: 0 var(--space-5);
  text-transform: uppercase;
}

#landing-hero h1 {
  color: var(--gray-0);
  max-width: 18ch;
  font-size: var(--text-display-md);
  font-weight: 800;
  letter-spacing: var(--tracking-display-lg);
  line-height: var(--leading-display-lg);
  margin-block: 0 var(--space-5);
  text-wrap: balance;
}

// Keep hero text fully opaque against the photograph.
.landing-lede {
  color: var(--gray-0);
  font-size: var(--text-body-lg);
  margin-block: 0;
  max-width: 48ch;
}

.landing-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-8);
}

.landing-cta {
  align-items: center;
  background-color: var(--gray-0);
  border-radius: var(--radius-md);
  color: #094b5e;
  display: inline-flex;
  font-size: var(--text-body);
  font-weight: 600;
  min-height: 44px;
  padding-inline: var(--space-8);
  text-decoration: none;
  transition: box-shadow 150ms ease, color 150ms ease;

  &:hover, &:focus { color: #0b5e75; text-decoration: none; }
  &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
}

.landing-cta-quiet {
  align-items: center;
  border: var(--border-thin) solid #97c9d8;
  border-radius: var(--radius-md);
  color: var(--gray-0);
  display: inline-flex;
  font-size: var(--text-body);
  font-weight: 600;
  min-height: 44px;
  padding-inline: var(--space-6);
  text-decoration: none;
  transition: background-color 150ms ease;

  &:hover, &:focus {
    background-color: #094b5e;
    color: var(--gray-0);
    text-decoration: none;
  }
  &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
}

// -------------------------------------------------------------- standards
#landing-standards {
  background-color: var(--color-surface);
  border-block: var(--border-thin) solid var(--border-subtle);
  padding-block: var(--space-6);

  ul {
    color: var(--text-secondary);
    display: grid;
    font-size: var(--text-body-sm);
    gap: var(--space-4) var(--space-10);
    grid-template-columns: 1fr;
    list-style: none;
    margin: 0;
    padding: 0;
  }
}

// ------------------------------------------------------------------ field
#landing-field {
  padding-block: var(--space-20);

  ul {
    display: grid;
    gap: var(--space-8);
    grid-template-columns: 1fr;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  figure { margin: 0; }

  img {
    aspect-ratio: 4 / 3;
    background-color: var(--color-surface-subtle);
    border-radius: var(--radius-lg);
    display: block;
    height: auto;
    object-fit: cover;
    width: 100%;
  }

  figcaption {
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    margin-top: var(--space-3);
  }
}

// --------------------------------------------------------------- sections
#landing-capabilities { padding-block: var(--space-20); }

.landing-capability-grid {
  display: grid;
  gap: var(--space-10);
  grid-template-columns: 1fr;

  h3 {
    font-size: var(--text-title);
    font-weight: 700;
    margin-block: 0 var(--space-3);
  }

  p { color: var(--text-secondary); margin: 0; max-width: 42ch; }
}

#landing-steps {
  background-color: var(--color-surface);
  border-block: var(--border-thin) solid var(--border-subtle);
  padding-block: var(--space-20);

  ol {
    display: grid;
    gap: var(--space-10);
    grid-template-columns: 1fr;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  h3 {
    font-size: var(--text-title);
    font-weight: 700;
    margin-block: var(--space-4) var(--space-2);
  }

  p { color: var(--text-secondary); margin: 0; max-width: 40ch; }
}

.landing-step-num {
  align-items: center;
  background-color: #094b5e;
  border-radius: var(--radius-pill);
  color: var(--gray-0);
  display: inline-flex;
  font-size: var(--text-body-sm);
  font-weight: 700;
  height: 32px;
  justify-content: center;
  width: 32px;
}

#landing-included { padding-block: var(--space-20); }

.landing-included-grid {
  display: grid;
  gap: 0 var(--space-10);
  grid-template-columns: 1fr;
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    border-top: var(--border-thin) solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: var(--text-body);
    padding-block: var(--space-3);
  }
}

#landing-close {
  background-color: #06313e;
  padding-block: var(--space-16);
  text-align: center;

  h2 {
    color: var(--gray-0);
    font-size: var(--text-headline);
    font-weight: 700;
    letter-spacing: var(--tracking-headline);
    margin-block: 0 var(--space-8);
    text-wrap: balance;
  }
}

#landing-footer { padding-block: var(--space-8); }

.landing-footer-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  justify-content: space-between;

  a { color: var(--link); font-size: var(--text-body-sm); }
}

.landing-host {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
}

#landing-uses { padding-block: var(--space-16); background: #e6f1f4; }
.landing-section-eyebrow { color: #094b5e; font-weight: 600; margin: 0 0 12px; }
#landing .landing-section-title { margin-bottom: 20px; }
.landing-section-intro { max-width: 65ch; margin-bottom: 36px; color: #405760; font-size: 18px; }
#landing .landing-capability-grid article {
  padding: 24px;
  border: 1px solid #c9d7dc;
  border-radius: 12px;
  background: white;
  min-width: 0;
}
#landing .landing-capability-grid { gap: 24px; }
#landing .landing-section-title, #landing h3 { overflow-wrap: anywhere; }
#landing-close p { color: white; max-width: 60ch; margin: 0 auto; font-size: 18px; }
#landing-close .landing-actions { justify-content: center; }
#landing a.landing-cta { color: #094b5e; }
#landing a.landing-cta:hover { color: #0b5e75; }
#landing a.landing-cta-quiet { color: white; }
#landing a:focus-visible { outline: 2px solid #0e7490; outline-offset: 4px; }
#landing-hero a:focus-visible, #landing-close a:focus-visible { outline-color: white; }
@media (max-width: 600px) {
  #landing .landing-inner { padding-inline: 20px; }
  #landing-hero h1 { font-size: 36px; line-height: 1.15; }
  #landing .landing-section-title, #landing-close h2 { font-size: 28px; }
  #landing .landing-capability-grid article { padding: 20px; }
  #landing .landing-actions { align-items: stretch; flex-direction: column; }
  #landing .landing-actions a { justify-content: center; padding-block: 10px; }
}
@media (prefers-reduced-motion: reduce) { #landing a { transition: none; } }

// ------------------------------------------------------------------ wider
@media (min-width: 768px) {
  #landing-hero h1 { font-size: var(--text-display-lg); }
  #landing-standards ul { grid-template-columns: repeat(3, 1fr); }
  // Fieldwork examples use two columns on wider screens.
  #landing-field ul { grid-template-columns: repeat(2, 1fr); }
  .landing-capability-grid { grid-template-columns: repeat(3, 1fr); }
  #landing-steps ol { grid-template-columns: repeat(3, 1fr); }
  .landing-included-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>

<i18n lang="json">
{
  "en": {
    "brand": "Field Data",
    "hero": {
      "eyebrow": "Field Data by Quantix Sierra Leone",
      "title": "From field collection to informed decisions",
      "body": "Build forms, collect responses, review records and explore results in one workspace. Field Data helps survey teams, programme managers and researchers turn fieldwork into useful evidence.",
      "secondary": "Explore the features"
    },
    "standards": {
      "items": [
        "Advanced form builder and XLSForm import",
        "Offline collection with ODK Collect",
        "Browser forms, maps and reporting"
      ]
    },
    "field": {
      "title": "Examples of fieldwork you can support"
    },
    "capabilities": {
      "eyebrow": "One workspace for your team",
      "title": "Tools for every stage of fieldwork",
      "body": "Prepare the questions, coordinate collection and follow the data through review and analysis.",
      "a": {
        "term": "Design advanced forms",
        "body": "Build forms visually or import XLSForm. Add skip logic, validation, calculations, repeated questions and choice lists, then preview and test before publishing."
      },
      "b": {
        "term": "Collect in the field or online",
        "body": "Use ODK Collect on Android to work offline and submit when a connection returns. Share browser form links for online responses, with GPS and media questions where needed."
      },
      "c": {
        "term": "Review and improve data quality",
        "body": "Review submissions, flag issues, leave comments and approve or reject records. Use the review queue and data cleaning tools to follow up on incomplete or inconsistent answers."
      },
      "d": {
        "term": "Explore maps and results",
        "body": "Browse responses as tables, maps, photos and charts. Use dashboards and reports to monitor collection, compare results and export data for further analysis."
      },
      "e": {
        "term": "Coordinate teams and follow-up",
        "body": "Organise projects and field teams, assign work and manage cases. Entity lists support repeat visits and tracking the same people, facilities or assets over time."
      },
      "f": {
        "term": "Share and connect your data",
        "body": "Control access with project permissions. Publish approved datasets, export CSV or OData, and connect other systems through webhooks and DHIS2 mapping."
      }
    },
    "uses": {
      "eyebrow": "Where Field Data can be used",
      "title": "Built around real fieldwork",
      "body": "Adapt the questions and workflow to your programme, from a one-off survey to ongoing visits and monitoring across districts.",
      "a": {
        "term": "Public health",
        "body": "Collect facility readiness assessments, community health surveys and service availability data. Map locations and prepare records for health reporting workflows."
      },
      "b": {
        "term": "Agriculture and livelihoods",
        "body": "Survey farms, crops, household livelihoods and markets. Combine observations with GPS coordinates and photos, and follow up through repeat visits."
      },
      "c": {
        "term": "Education",
        "body": "Assess school facilities, staffing and learning resources. Coordinate visits across districts and review responses before preparing programme reports."
      },
      "d": {
        "term": "NGOs and development programmes",
        "body": "Run baseline and endline surveys, monitor activities and manage beneficiary follow-up. Keep teams, assignments and reviewed records in a shared workspace."
      },
      "e": {
        "term": "Research and household surveys",
        "body": "Prepare structured questionnaires, apply validation rules and organise enumerators. Export reviewed responses for statistical analysis."
      },
      "f": {
        "term": "Infrastructure and environmental monitoring",
        "body": "Record water points, public assets and environmental observations. Use photos and locations to document conditions and organise follow-up inspections."
      }
    },
    "steps": {
      "title": "How your team gets started",
      "a": {
        "term": "Prepare a project and form",
        "body": "Create a project, build or import a form, configure access and test the draft with the people who will use it."
      },
      "b": {
        "term": "Collect and coordinate",
        "body": "Assign your team, distribute forms to ODK Collect or share browser links, and monitor incoming submissions."
      },
      "c": {
        "term": "Review, analyse and share",
        "body": "Resolve issues, approve records, explore results and export or share the data your programme needs."
      }
    },
    "included": {
      "title": "More tools in your workspace",
      "items": [
        "Reusable form templates and choice lists",
        "Form drafts, previews and versioning",
        "Public form links and access controls",
        "GPS questions, photos and attachments",
        "Saved analysis and reporting views",
        "Case records and field assignments",
        "Entity lists for repeat data collection",
        "Submission comments and review history",
        "CSV exports and OData access",
        "Public catalogues and approved datasets",
        "DHIS2 mapping and webhooks",
        "Audit logs, backups and operations monitoring"
      ]
    },
    "close": {
      "title": "Planning your next fieldwork project?",
      "body": "Contact Quantix Sierra Leone to discuss how Field Data could fit your team's collection and reporting workflow. Already have an account? Sign in to your workspace.",
      "contact": "Contact Quantix Sierra Leone"
    },
    "footer": {
      "docs": "ODK documentation"
    }
  }
}
</i18n>
