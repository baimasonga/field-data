<!--
Public front door. An anonymous visitor arriving at the root sees this rather
than a login form; the router sends deep links straight to login as before.
-->
<template>
  <div id="landing">
    <section id="landing-hero">
      <div class="landing-inner">
        <svg class="landing-mark" viewBox="0 0 64 64" role="img"
          :aria-label="$t('brand')">
          <path fill="currentColor" fill-rule="evenodd" d="M32 3C18.75 3 8 13.75 8 27c0 15.5 24 34 24 34s24-18.5 24-34C56 13.75 45.25 3 32 3zM24 28a2.5 2.5 0 0 1 5 0v10a2.5 2.5 0 0 1-5 0V28zm8-6a2.5 2.5 0 0 1 5 0v16a2.5 2.5 0 0 1-5 0V22zm8-6a2.5 2.5 0 0 1 5 0v22a2.5 2.5 0 0 1-5 0V16z"/>
        </svg>
        <h1>{{ $t('hero.title') }}</h1>
        <p class="landing-lede">{{ $t('hero.body') }}</p>
        <div class="landing-actions">
          <router-link to="/login" class="landing-cta">
            {{ $t('action.logIn') }}
          </router-link>
        </div>
      </div>
    </section>

    <section id="landing-capabilities">
      <div class="landing-inner">
        <ul>
          <li v-for="item in capabilities" :key="item.term">
            <h2>{{ item.term }}</h2>
            <p>{{ item.body }}</p>
          </li>
        </ul>
      </div>
    </section>

    <footer id="landing-footer">
      <div class="landing-inner">
        <span class="landing-host">{{ hostname }}</span>
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

const { t } = useI18n();
const hostname = window.location.hostname;
const capabilities = computed(() => ['offline', 'review', 'export']
  .map(key => ({ term: t(`capability.${key}.term`), body: t(`capability.${key}.body`) })));
</script>

<style lang="scss">
#landing {
  background-color: var(--color-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

.landing-inner {
  margin-inline: auto;
  max-width: var(--container-lg);
  padding-inline: var(--space-6);
}

// The one gradient in this view: the system reserves it for brand moments,
// and this is the only one the page gets. Dusk rather than aurora because the
// hero carries text: white falls to 2.9 and 2.31 against aurora's pink and
// coral stops, while dusk's darkest stop still leaves 8.58.
#landing-hero {
  background: var(--gradient-dusk);
  color: var(--gray-0);
  padding-block: var(--space-16) var(--space-20);
  text-align: center;

  .landing-mark {
    display: block;
    margin-inline: auto;
    width: 64px;
    height: 64px;
    color: var(--gray-0);
  }

  h1 {
    color: var(--gray-0);
    font-size: var(--text-display-md);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-block: var(--space-6) var(--space-4);
    text-wrap: balance;
  }
}

// Full opacity on the gradient: the system forbids alpha-muted text there.
.landing-lede {
  font-size: var(--text-body-lg);
  margin-block: 0;
  margin-inline: auto;
  max-width: 54ch;
  color: var(--gray-0);
}

.landing-actions { margin-top: var(--space-8); }

.landing-cta {
  background-color: var(--gray-0);
  border-radius: var(--radius-md);
  color: var(--accent);
  display: inline-block;
  font-size: var(--text-body);
  font-weight: 600;
  min-height: 44px;
  padding: var(--space-3) var(--space-8);
  text-decoration: none;
  transition: box-shadow 150ms ease, color 150ms ease;

  &:hover, &:focus { color: var(--accent-hover); text-decoration: none; }
  &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
}

#landing-capabilities {
  padding-block: var(--space-16);

  ul {
    display: grid;
    gap: var(--space-8);
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    list-style: none;
    margin: 0;
    padding: 0;
  }

  h2 {
    font-size: var(--text-title);
    font-weight: 600;
    margin-block: 0 var(--space-2);
  }

  p {
    color: var(--text-secondary);
    margin: 0;
  }
}

#landing-footer {
  border-top: 1px solid var(--border-subtle);
  padding-block: var(--space-6);
}

.landing-host {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
}
</style>

<i18n lang="json5">
{
  "en": {
    "brand": "Field Data",
    "hero": {
      "title": "Collect field data anywhere, review it in one place",
      "body": "Field Data runs surveys on phones that work without a signal, then brings every submission back here for review, cleaning and export."
    },
    "capability": {
      "offline": {
        "term": "Works offline",
        "body": "Enumerators fill forms with no connection and submit when they next reach one. Nothing is lost in between."
      },
      "review": {
        "term": "Review before it counts",
        "body": "Flag submissions that need a second look, leave comments for the field team, and approve the rest."
      },
      "export": {
        "term": "Take the data with you",
        "body": "Download submissions and attachments, or connect the API to the tools your analysts already use."
      }
    }
  }
}
</i18n>
