<!-- This component renders the skeleton of an account page (login, password
reset, etc.), using the server config related to the login page. The component
expects to receive the page content in a slot, which the component will style.

Field Data: redesigned as a split screen — a bold green→teal→blue brand panel
carrying the logo and tagline on the left, and the form content on the right. -->
<template>
  <div id="account-page-container" :inert="preview">
    <div id="account-page-container-brand" :style="brandStyle">
      <div id="account-page-container-brand-inner">
        <div id="account-page-container-logo">
          <!-- This will load the default logo eagerly, even before the response
          for serverConfig has been received. The goal is to show the default
          logo more quickly if a custom logo isn't configured. -->
          <img v-if="logoUrl == null" src="../../../assets/images/field-data-logo.png"
            :alt="$t('login.odkLogo')" v-on="imgHandlers">
          <img v-else :src="logoUrl"
            :alt="$t('login.customLogoAlt')" v-on="imgHandlers">
          <spinner/>
        </div>
        <p id="account-page-container-tagline">{{ $t('login.tagline') }}</p>
      </div>
      <p id="account-page-container-region">{{ $t('login.region') }}</p>
    </div>
    <div id="account-page-container-form">
      <div id="account-page-container-main"><slot></slot></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

import Spinner from '../../spinner.vue';

import { apiPaths } from '../../../util/request';
import { useRequestData } from '../../../request-data';

defineOptions({
  name: 'AccountPageContainer'
});
const props = defineProps({
  // `true` if the component is being previewed in ConfigLoginPreview
  preview: Boolean
});

// The component does not assume that this data will exist when the component is
// created.
const { serverConfig } = useRequestData();

const blobUrl = (key) => computed(() => {
  if (!serverConfig.dataExists) return null;
  const config = serverConfig[key];
  if (config == null || !config.blobExists) return null;
  // The `ts` query parameter isn't for Backend: it's for cache-busting.
  return apiPaths.publicConfig(key, { ts: Date.parse(config.setAt) });
});
const logoUrl = blobUrl('logo');
const heroUrl = blobUrl('hero-image');

// If a custom hero image is configured, layer the brand gradient over it;
// otherwise the stylesheet's plain gradient shows through.
const brandStyle = computed(() => (heroUrl.value == null
  ? null
  : {
    backgroundImage: `linear-gradient(155deg, rgba(31, 138, 82, 0.85), rgba(14, 116, 144, 0.82) 52%, rgba(24, 95, 149, 0.85)), url("${heroUrl.value}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }));

const imgHandlers = {
  // eslint-disable-next-line no-param-reassign
  load: (event) => { event.target.dataset.loaded = 'true'; },
  // eslint-disable-next-line no-param-reassign
  error: (event) => { event.target.dataset.error = 'true'; }
};
</script>

<style lang="scss">
@import '../../../assets/scss/mixins';

#account-page-container {
  display: flex;
  min-height: 560px;
  background-color: #fff;
}

////////////////////////////////////////////////////////////////////////////////
// BRAND PANEL

#account-page-container-brand {
  flex: 1 1 46%;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 44px;
  overflow: hidden;
  background: linear-gradient(155deg, #1f8a52 0%, #0e7490 52%, #185f95 100%);

  // Faint circuit-style rings, echoing the logo mark.
  &::before, &::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    pointer-events: none;
  }
  &::before {
    width: 520px; height: 520px; right: -150px; top: -130px;
    box-shadow: inset 0 0 0 60px rgba(255, 255, 255, 0.05);
  }
  &::after { width: 360px; height: 360px; left: -120px; bottom: -150px; }
}

#account-page-container-brand-inner {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 380px;
}

#account-page-container-logo {
  background: rgba(255, 255, 255, 0.94);
  border-radius: 16px;
  padding: 28px 34px;
  box-shadow: 0 18px 45px rgba(6, 40, 50, 0.28);
  margin-bottom: 26px;
  position: relative; // Needed for Spinner.

  img {
    display: block;
    max-height: 132px;
    max-width: 100%;
    // Prevent images from flashing; fade them into view.
    opacity: 0;
    &[data-loaded] { opacity: 1; }
    transition: opacity 0.45s;
  }
  &:has(img[data-loaded]) .spinner { display: none; }
  // If the (custom) logo fails to load, drop the whole plaque.
  &:has(img[data-error]) { display: none; }
}

#account-page-container-tagline {
  margin: 0;
  color: #fff;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.2px;
  text-wrap: balance;
}

#account-page-container-region {
  position: absolute;
  z-index: 2;
  bottom: 30px;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0 40px;
  text-align: center;
  color: rgba(255, 255, 255, 0.82);
  font-size: 12.5px;
  letter-spacing: 0.3px;
  text-wrap: balance;
}

////////////////////////////////////////////////////////////////////////////////
// FORM PANEL

#account-page-container-form {
  flex: 1 1 54%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 40px;
  background-color: #fff;
}

#account-page-container-main {
  width: 100%;
  max-width: 400px;

  $margin-after-title: 28px;

  h1 {
    @include break-word;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin-block: 0 12px;
  }

  // Subtitle (optional). The slot may or may not render this element.
  h1 + p {
    font-size: 15px;
    line-height: 20px;
    color: $color-text-secondary;
    margin-block: 0 $margin-after-title;

    &:empty { display: none; }
  }

  // Using :where() to decrease specificity, so that the default border-color
  // applies when the .form-control is focused.
  :where(&) .form-group .form-control {
    background-color: $color-page-background;
    border-width: 1.5px;
    border-color: #d5e2e5;
    border-radius: 9px;

    &::placeholder { color: $color-input-inactive; }
    &:focus {
      border-color: $color-accent-primary;
      box-shadow: 0 0 0 4px rgba($color-accent-primary, 0.22);
    }
  }

  form > div:has(.btn + .btn) {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
  }

  // Removing padding-inline so that the buttons will be aligned if they wrap.
  .btn-link { padding-inline: 0; }
}

////////////////////////////////////////////////////////////////////////////////
// RESPONSIVE

@media (max-width: $screen-sm-min) {
  #account-page-container { flex-direction: column; min-height: auto; }

  #account-page-container-brand {
    padding: 34px 24px 26px;
    &::before, &::after { display: none; }
  }
  #account-page-container-logo {
    padding: 20px 24px;
    margin-bottom: 16px;
    img { max-height: 92px; }
  }
  #account-page-container-tagline { font-size: 16px; }
  #account-page-container-region { position: static; margin-top: 16px; }
  #account-page-container-form { padding: 32px 24px; }
}
</style>
