**Icon** — a Lucide line glyph. Inherits `currentColor` and sizes to `1em`, so it adopts the color and size of its context; pass `size` to fix it.

```jsx
<Icon name="sparkles" />
<Icon name="arrow-right" size={18} />
<Button iconLeft={<Icon name="plus" />}>New</Button>
```

Names are Lucide kebab-case (`chevron-down`, `external-link`, `circle-check`). Decorative by default; pass `label` when the icon carries meaning on its own. The system standardizes on Lucide's 2px stroke — don't mix other icon sets.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * A line icon from the Lucide set (the system's chosen icon family). Renders an
 * inline SVG that inherits `currentColor` and sizes to `1em` by default, so it
 * matches the text or button it sits in. Glyph data ships with the system
 * (offline-safe); pass any bundled Lucide name in kebab-case.
 */
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide icon name, kebab-case (e.g. "arrow-right", "chevron-down", "circle-check"). */
  name: string;
  /** Explicit size in px (number) or any CSS length. Defaults to 1em. */
  size?: number | string;
  /** Stroke width. @default 2 */
  strokeWidth?: number;
  /** Accessible label. Omit for decorative icons (they render aria-hidden). */
  label?: string;
}

export declare function Icon(props: IconProps): JSX.Element;
```
