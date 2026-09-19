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
      <div class="landing-inner landing-hero-grid">
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

        <!-- Abstract composition, not a screenshot: a form being filled, the
        submissions it becomes, and where they were captured. -->
        <div class="landing-figure" aria-hidden="true">
          <div class="landing-card landing-card-map">
            <span v-for="pin in pins" :key="pin.id" class="landing-pin"
              :style="{ left: `${pin.x}%`, top: `${pin.y}%` }"></span>
          </div>
          <div class="landing-card landing-card-form">
            <span class="landing-card-title">{{ $t('figure.form') }}</span>
            <span class="landing-line landing-line-lg"></span>
            <span class="landing-line"></span>
            <span class="landing-chip-row">
              <span class="landing-chip landing-chip-on"></span>
              <span class="landing-chip"></span>
              <span class="landing-chip"></span>
            </span>
            <span class="landing-line landing-line-sm"></span>
          </div>
          <div class="landing-card landing-card-rows">
            <span v-for="(state, i) in rowStates" :key="i" class="landing-row">
              <span class="landing-dot" :class="`is-${state}`"></span>
              <span class="landing-line landing-line-row"></span>
            </span>
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

defineOptions({
  name: 'Landing'
});

const { t, tm, rt } = useI18n();
const hostname = window.location.hostname;

const rowStates = ['approved', 'issues', 'received', 'edited', 'received'];
const pins = [
  { id: 1, x: 22, y: 34 }, { id: 2, x: 47, y: 22 }, { id: 3, x: 63, y: 52 },
  { id: 4, x: 34, y: 66 }, { id: 5, x: 78, y: 38 }
];

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
  background: var(--gradient-dusk);
  color: var(--gray-0);
  overflow: hidden;
  padding-block: var(--space-16) var(--space-20);
}

.landing-hero-grid {
  align-items: center;
  display: grid;
  gap: var(--space-12);
  grid-template-columns: 1fr;
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

// ---------------------------------------------------------------- figure
.landing-figure {
  min-height: 320px;
  position: relative;
}

.landing-card {
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  position: absolute;
}

.landing-card-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  left: 0;
  padding: var(--space-5);
  top: 0;
  width: 60%;
  z-index: 2;
}

.landing-card-title {
  color: var(--text-primary);
  font-size: var(--text-caption);
  font-weight: 600;
}

.landing-line {
  background-color: var(--gray-150);
  border-radius: var(--radius-pill);
  display: block;
  height: 8px;
  width: 100%;
}
.landing-line-lg { height: 10px; width: 80%; }
.landing-line-sm { width: 45%; }
.landing-line-row { height: 7px; }

.landing-chip-row { display: flex; gap: var(--space-2); }

.landing-chip {
  background-color: var(--gray-100);
  border-radius: var(--radius-pill);
  height: 16px;
  width: 34px;
}
.landing-chip-on { background-color: var(--accent); }

.landing-card-rows {
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  right: 0;
  width: 64%;
  z-index: 3;
}

.landing-row { align-items: center; display: flex; gap: var(--space-3); }

.landing-dot {
  border-radius: var(--radius-pill);
  flex: none;
  height: 8px;
  width: 8px;
}
.landing-dot.is-approved { background-color: var(--success); }
.landing-dot.is-issues { background-color: var(--warning); }
.landing-dot.is-edited { background-color: var(--gray-400); }
.landing-dot.is-received { background-color: var(--accent); }

.landing-card-map {
  background-color: var(--iris-900);
  height: 160px;
  right: 4%;
  top: 2%;
  width: 52%;
  z-index: 1;
}

.landing-pin {
  background-color: var(--iris-300);
  border-radius: var(--radius-pill);
  box-shadow: 0 0 0 4px var(--iris-800);
  height: 10px;
  position: absolute;
  width: 10px;
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
  .landing-hero-grid { grid-template-columns: 1.05fr 0.95fr; }
  #landing-hero h1 { font-size: var(--text-display-lg); }
  .landing-figure { min-height: 360px; }
  #landing-standards ul { grid-template-columns: repeat(3, 1fr); }
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
