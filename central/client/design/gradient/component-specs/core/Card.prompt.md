**Card** — the surface container for grouped content. Compose freely inside; the card only owns background, border, radius, padding, and elevation.

```jsx
<Card>Default surface</Card>
<Card variant="elevated" padding="lg">Floating panel</Card>
<Card variant="gradient" interactive>Brand-accented, hover-lifts</Card>
```

Variants: `default` (hairline + xs shadow) · `elevated` (borderless, lg shadow) · `flat` (sunken, inset panels) · `gradient` (aurora 1.5px border — one per view). `padding` `none|sm|md|lg`; `interactive` adds hover lift.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * The surface container. `default` for most content, `elevated` when it floats,
 * `flat` for nested/inset panels, `gradient` for a single brand-accented card.
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** @default 'default' */
  variant?: 'default' | 'elevated' | 'flat' | 'gradient';
  /** Interior padding. @default 'md' */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Adds hover-lift + pointer for clickable cards. */
  interactive?: boolean;
  /** Override the rendered element. @default 'div' */
  as?: React.ElementType;
  children?: React.ReactNode;
}

export declare function Card(props: CardProps): JSX.Element;
```
