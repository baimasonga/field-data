**Checkbox** — a boolean toggle for lists and forms; use for independent options (not mutually exclusive — that's **Radio**).

```jsx
<Checkbox label="Email me updates" defaultChecked />
<Checkbox label="Select all" indeterminate />
```

`label`, `indeterminate`, and all native input props (`checked`, `defaultChecked`, `onChange`, `disabled`) pass through.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A checkbox with an optional inline label. Supports an indeterminate state. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Inline label text/node. */
  label?: React.ReactNode;
  /** Render the indeterminate (mixed) state. */
  indeterminate?: boolean;
}

export declare function Checkbox(props: CheckboxProps): JSX.Element;
```
