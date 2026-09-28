**Radio** — a single choice within a mutually exclusive group. Share one `name` across the group.

```jsx
<Radio name="plan" value="mo" label="Monthly" defaultChecked />
<Radio name="plan" value="yr" label="Yearly" />
```

`label` plus native input props (`name`, `value`, `checked`, `onChange`, `disabled`). For independent on/off options use **Checkbox**; for a binary setting use **Switch**.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A radio button for mutually exclusive choices. Give one `name` to a group. */
export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Inline label text/node. */
  label?: React.ReactNode;
}

export declare function Radio(props: RadioProps): JSX.Element;
```
