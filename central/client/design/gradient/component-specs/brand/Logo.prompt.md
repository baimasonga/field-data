**Logo** — the Gradient lockup. `full` (mark + wordmark) for headers, `mark` alone for favicons/avatars, `wordmark` for tight spaces.

```jsx
<Logo />
<Logo variant="mark" size={40} />
<Logo mono style={{ color: 'var(--text-primary)' }} />
```

`variant` `full | mark | wordmark`; `size` scales the whole lockup; `mono` swaps the gradient tile for a solid `currentColor` version (footers, watermarks, one-color print).

⚠️ The mark is an **original placeholder** for this from-scratch brand (a CSS gradient tile), not a real logo — replace it with the actual brand mark when one exists.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * The Gradient logo — a placeholder gradient-tile mark plus the wordmark.
 * NOTE: an original generic device for this from-scratch brand, not a real
 * company logo; swap in the true mark when available.
 */
export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Lockup. @default 'full' */
  variant?: 'full' | 'mark' | 'wordmark';
  /** Wordmark font-size in px; the mark scales with it. @default 28 */
  size?: number;
  /** Monochrome (uses currentColor for the mark) instead of the gradient. */
  mono?: boolean;
}

export declare function Logo(props: LogoProps): JSX.Element;
```
