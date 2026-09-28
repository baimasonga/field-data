**Badge** — a small status or category pill (e.g. "Beta", "Active", "3 new"). Tinted by default.

```jsx
<Badge variant="success" dot>Live</Badge>
<Badge variant="accent">New</Badge>
<Badge variant="danger" solid>Down</Badge>
```

Variants `neutral | accent | success | warning | danger | info`; sizes `sm | md`; `dot` adds a status dot; `solid` fills for high emphasis. For removable, interactive content labels use **Tag** instead.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A small status/label pill. Tinted by default; `solid` for high emphasis. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** @default 'neutral' */
  variant?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** @default 'md' */
  size?: 'sm' | 'md';
  /** Show a leading status dot. */
  dot?: boolean;
  /** Filled (solid color) instead of tinted. */
  solid?: boolean;
  children?: React.ReactNode;
}

export declare function Badge(props: BadgeProps): JSX.Element;
```
