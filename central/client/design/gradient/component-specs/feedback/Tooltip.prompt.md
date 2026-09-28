**Tooltip** — a short hint on hover/focus. Wrap the trigger; keep content to a few words.

```jsx
<Tooltip content="Copy link" side="top">
  <IconButton label="Copy"><Icon name="link" /></IconButton>
</Tooltip>
```

`side` `top | bottom | left | right`; `delay` (ms); pass `open` to control it manually. Don't put essential info only in a tooltip — it's supplementary.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A hover/focus tooltip. Wraps a trigger; shows a small dark bubble on one side. */
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tooltip content (keep it short). */
  content: React.ReactNode;
  /** @default 'top' */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Open delay in ms. @default 120 */
  delay?: number;
  /** Controlled visibility — omit to use built-in hover/focus. */
  open?: boolean;
  /** The trigger element. */
  children?: React.ReactNode;
}

export declare function Tooltip(props: TooltipProps): JSX.Element;
```
