**Switch** — a toggle for a setting that takes effect immediately (not a form value you submit — use **Checkbox** for that).

```jsx
<Switch label="Dark mode" defaultChecked />
<Switch size="sm" aria-label="Notifications" />
```

`label`, `size` `sm | md`, and native input props (`checked`, `defaultChecked`, `onChange`, `disabled`). Renders with `role="switch"`.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A toggle for a binary setting that applies immediately (e.g. a preference). */
export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Inline label text/node. */
  label?: React.ReactNode;
  /** @default 'md' */
  size?: 'sm' | 'md';
}

export declare function Switch(props: SwitchProps): JSX.Element;
```
