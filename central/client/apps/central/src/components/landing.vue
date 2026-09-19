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
            <a href="#landing-included" class="landing-cta-quiet">
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
        <h2 class="landing-section-title">{{ $t('capabilities.title') }}</h2>
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
        <router-link to="/login" class="landing-cta">
          {{ $t('action.logIn') }}
        </router-link>
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
const hostname = window.location.hostname;

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


const pairs = (key) => computed(() => ['a', 'b', 'c']
  .map(k => ({ term: t(`${key}.${k}.term`), body: t(`${key}.${k}.body`) })));
const capabilities = pairs('capabilities');
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
// The one gradient in this view. Dusk rather than the signature aurora
// because the hero carries text: white falls to 2.9 and 2.31 against
// aurora's pink and coral stops, while dusk holds 8.58 at its lightest.
#landing-hero {
  background-color: var(--gray-1000);
  background-image: url('../assets/images/landing/water-point-survey.webp');
  background-position: center 40%;
  background-size: cover;
  color: var(--gray-0);
  overflow: hidden;
  padding-block: var(--space-20) var(--space-24);
  position: relative;

  // The scrim. At 0.82 the worst case -- a white sky pixel directly behind the
  // headline -- still leaves white text at 5.2:1, and the photograph stays
  // readable. The dark background-color underneath keeps the text legible in
  // the moment before the image paints.
  &::before {
    background: var(--gradient-dusk);
    content: '';
    inset: 0;
    opacity: 0.82;
    position: absolute;
  }

  .landing-inner { position: relative; }
}

.landing-eyebrow {
  color: var(--iris-200);
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

// Full opacity on the gradient: the system forbids alpha-muted text there.
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
  color: var(--accent);
  display: inline-flex;
  font-size: var(--text-body);
  font-weight: 600;
  min-height: 44px;
  padding-inline: var(--space-8);
  text-decoration: none;
  transition: box-shadow 150ms ease, color 150ms ease;

  &:hover, &:focus { color: var(--accent-hover); text-decoration: none; }
  &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
}

.landing-cta-quiet {
  align-items: center;
  border: var(--border-thin) solid var(--iris-300);
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
    background-color: var(--iris-800);
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
  background-color: var(--accent);
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
  background-color: var(--iris-900);
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

// ------------------------------------------------------------------ wider
@media (min-width: 768px) {
  #landing-hero h1 { font-size: var(--text-display-lg); }
  #landing-standards ul { grid-template-columns: repeat(3, 1fr); }
  // Five photographs: two wide across the top, three beneath, so the rows
  // fill rather than leaving a ragged tail.
  #landing-field ul { grid-template-columns: repeat(2, 1fr); }
  .landing-capability-grid { grid-template-columns: repeat(3, 1fr); }
  #landing-steps ol { grid-template-columns: repeat(3, 1fr); }
  .landing-included-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>

<i18n lang="json5">
{
  "en": {
    "brand": "Field Data",
    "hero": {
      "eyebrow": "Field data collection",
      "title": "Run surveys where the signal doesn't reach",
      "body": "Enumerators fill forms on phones with no connection and submit when they next find one. Every response lands here, ready to review, correct and export.",
      "secondary": "What's included"
    },
    "figure": { "form": "Household Roster" },
    "standards": {
      "items": [
        "Forms authored as XLSForm",
        "Works with ODK Collect on Android",
        "Your own database and object storage"
      ]
    },
    "field": { "title": "In the field" },
    "capabilities": {
      "title": "Built for how field teams actually work",
      "a": {
        "term": "Collection that survives the field",
        "body": "Forms run offline on Android or in a browser. Skip logic, constraints, repeats, GPS, photos and signatures all work with no connection."
      },
      "b": {
        "term": "Review before the data counts",
        "body": "Every submission carries a state: received, has issues, edited, approved or rejected. Comment on the ones that need a second look, and the history stays with the record."
      },
      "c": {
        "term": "Data that stays yours",
        "body": "Submissions sit in your own database and object storage. Pull them out over OData or CSV, or push changes onward with webhooks."
      }
    },
    "steps": {
      "title": "From question to answer",
      "a": {
        "term": "Design the form",
        "body": "Write it as an XLSForm, upload it, and test the draft on real devices before anyone goes out."
      },
      "b": {
        "term": "Collect",
        "body": "Assign app users or publish a link. Field teams work offline and submit when they reconnect."
      },
      "c": {
        "term": "Review and export",
        "body": "Work the queue, fix what needs fixing, then take the data into your analysis tools."
      }
    },
    "included": {
      "title": "What's included",
      "items": [
        "Offline collection with ODK Collect",
        "Web forms in the browser",
        "Form drafts and device testing",
        "Submission review states and comments",
        "Map view of submissions",
        "Entity lists for longitudinal work",
        "App users and public access links",
        "Project-level encryption",
        "OData feed and CSV export",
        "Media and attachment storage",
        "Encrypted backups",
        "Webhooks and an audit log"
      ]
    },
    "close": { "title": "Already have an account?" },
    "footer": { "docs": "Documentation" }
  }
}
</i18n>
