# Public Field Data landing page

The public page at fielddata.quantixsl.com explains the product before asking a
visitor to sign in. It uses the existing Vue, localization, typography and teal
brand styles. Signed-in pages and the login page retain their application chrome.

## Research and attached skills

The attached better-interface skill and its accessibility, layout, writing,
typography, colors and UI owners guided the redesign. Archive instructions were
used as design guidance within the requested landing-page scope.

Official sources read on 2026-10-04:

- [Ona Platform overview](https://github.com/onaio/onadata/blob/master/README.rst):
  collection, analysis and sharing are the organizing stages. Field Data presents
  the complete workflow rather than leading with a long feature inventory.
- [KoboToolbox overview](https://github.com/kobotoolbox/docs/blob/master/source/about_kobotoolbox.md)
  and [quickstart](https://github.com/kobotoolbox/docs/blob/master/source/quick_start.md):
  connect capabilities to field conditions and social-impact work; explain form
  building, deployment, collection and data management in a short sequence.
- [ODK Central overview](https://github.com/getodk/central/blob/master/README.md):
  form management, collection clients, project permissions and interoperable APIs.
  Field Data explains offline collection through ODK Collect and separately
  describes browser links, review and exports.

The environment denied direct access to ona.io, www.kobotoolbox.org and
getodk.org. The user requested an allowlist update, but it was not available in
this running environment during verification. These findings are documentation
research, not a claim that current competitor landing-page layouts were inspected.
No competitor copy, logos, customer claims, pricing or certifications were reused.

## Page structure

1. Product navigation, concise value proposition and project-contact action.
2. Screenshot of the actual Field Data dashboard, clearly labelled example data.
3. Six feature areas and a three-stage project workflow.
4. Offline collection guidance with a fieldwork illustration.
5. Six sector use cases and native expandable FAQs.
6. Quantix email and telephone links, login, catalogue and documentation resources.

The workspace screenshot contains synthetic projects, users and responses. It
contains no production records or credentials. Its JPEG payload is about 91 KB;
the fieldwork image loads lazily. Existing self-hosted fonts are reused.

## Verification

- Full fixture browser suite: 35 passing checks, including new public-page
  keyboard, FAQ, contact and login-navigation checks at 1280px and 320px.
- Landing layout inspected at 1440, 1024, 768, 640, 375 and 320px, with no
  document overflow. Product and fieldwork images decode successfully.
- Chromium CSS zoom at 200%, RTL layout at 320px, extended navigation labels,
  reduced-motion mode and forced-colors focus checked.
- Rendered landing text color pairs measured against their solid backgrounds:
  the minimum observed contrast is 5.36:1. This excludes text within the product
  screenshot and does not constitute an accessibility certification.
- One main landmark and one page h1; visible focus and 44px navigation targets;
  native details/summary disclosures with visible expand/collapse cues.
- Vue/test lint, production build and whitespace checks completed separately.

Screen-reader testing with assistive technology and current competitor visual
comparison remain unverified.
