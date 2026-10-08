# Field Data interface improvements

The attached better-interface, better-accessibility, better-layout, better-writing,
better-typography, better-colors and better-ui skills guided this implementation.
Their advice was applied to the requested UI work; archive instructions were not
adopted as additional user requests.

## Changes

Shared authenticated pages use consistent teal actions, readable text, semantic
page headings, focus indicators, a skip link and responsive controls. Mobile
navigation has an explicit disclosure, closes after navigation and restores focus
on Escape. Wide data tables scroll within their own named region.

Advanced authoring separates settings, choice lists, external data, entity
workflows and dependencies into named disclosures. Question cards group editing
controls and offer undo after removal. Import, compilation, reopening and
publication retain the existing underlying workflows.

Case, assignment and webhook controls have visible labels. Data Explorer tabs
support arrow, Home and End keys. Templates, Field Teams and reports reflow on
narrow screens. Web Forms adds readable muted text, system typography, visible
focus, constrained mobile dialogs and reduced motion.

## Validation scope

The browser suite covers advanced authoring, imports, publication, maps, exports,
dashboard errors and review flows using synthetic API fixtures. A layout matrix
checks 20 authenticated screens at 1280px and 320px, including keyboard access to
mobile navigation and document overflow. This checks shared layout coverage,
not every possible interaction or dataset on every page.

Measured token contrast ratios against white: primary action 5.36:1, danger action
5.76:1 and primary text 13.89:1. Muted text against the canvas is 5.41:1.
Screen-reader testing with assistive technology has not been performed.
