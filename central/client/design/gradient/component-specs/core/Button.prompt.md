**Button** — the primary action control; use `gradient` for the single hero CTA per view, `primary` for standard actions, `secondary`/`ghost` for lower-emphasis ones.

```jsx
<Button variant="gradient" size="lg" iconRight={<Icon name="arrow-right" />}>
  Start for free
</Button>
<Button variant="secondary">Docs</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

Variants: `primary` (iris solid) · `gradient` (iris gradient + glow, brand moment) · `secondary` (bordered surface) · `ghost` (quiet) · `danger`. Sizes `sm | md | lg`. Props: `loading`, `fullWidth`, `iconLeft`, `iconRight`, `href` (renders `<a>`), `as`. Keep at most one `gradient` button visible at a time.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * The primary action control. Iris-solid by default; `gradient` is the brand
 * moment (one per view); `secondary`/`ghost` recede.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default 'primary' */
  variant?: 'primary' | 'gradient' | 'secondary' | 'ghost' | 'danger';
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  /** Show a spinner and block interaction. */
  loading?: boolean;
  /** Node rendered before the label (an Icon). */
  iconLeft?: React.ReactNode;
  /** Node rendered after the label (an Icon). */
  iconRight?: React.ReactNode;
  /** Render as an anchor when set. */
  href?: string;
  /** Override the rendered element/component. */
  as?: React.ElementType;
}

export declare function Button(props: ButtonProps): JSX.Element;
```
