<template>
  <footer class="organization-footer" :aria-label="$t('contact')">
    <div class="organization-footer-inner">
      <p class="organization-footer-brand">Field Data <span aria-hidden="true">·</span> Quantix Sierra Leone</p>
      <address>
        <a href="mailto:contact@quantixsl.com">contact@quantixsl.com</a>
        <span class="organization-footer-phones">
          <span>{{ $t('telephone') }}:</span>
          <a href="tel:+23276141009">+232 76 141 009</a>
          <span aria-hidden="true">/</span>
          <a href="tel:+23276603107">+232 76 603 107</a>
        </span>
      </address>
    </div>
  </footer>
</template>

<script setup>
defineOptions({ name: 'OrganizationFooter' });
</script>

<style lang="scss" scoped>
.organization-footer {
  margin-top: 32px;
  padding: 24px;
  border-top: 1px solid #c9d7dc;
  background: #f6f9fa;
  color: #405760;
  font-size: 14px;
  line-height: 1.6;
}
.organization-footer-inner { max-width: 1200px; margin: 0 auto; }
.organization-footer-brand { margin: 0 0 8px; font-weight: 600; }
address {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  font-style: normal;
}
a {
  color: #094b5e;
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
  &:focus-visible { outline: 2px solid #0e7490; outline-offset: 3px; }
}
.organization-footer-phones { display: flex; flex-wrap: wrap; gap: 4px 8px; }
@media (max-width: 600px) {
  .organization-footer { padding: 20px 16px; }
  a { display: inline-flex; align-items: center; min-height: 44px; }
}
@media print { .organization-footer { display: none; } }
</style>

<i18n lang="json">
{
  "en": {
    "contact": "Contact Quantix Sierra Leone",
    "telephone": "Telephone"
  }
}
</i18n>
