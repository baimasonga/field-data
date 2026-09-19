**Select** — a styled native dropdown. Uses the real `<select>`, so it's accessible and keyboard-friendly out of the box.

```jsx
<Select defaultValue="mo">
  <option value="wk">Weekly</option>
  <option value="mo">Monthly</option>
  <option value="yr">Yearly</option>
</Select>
```

`size` `sm | md | lg`; `invalid` for errors. Pass `<option>`s as children. For multi-select filter chips use **Tag** instead.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A styled wrapper over the native `<select>`, with a chevron affordance. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Error styling + aria-invalid. */
  invalid?: boolean;
  /** `<option>` / `<optgroup>` children. */
  children?: React.ReactNode;
}

export declare function Select(props: SelectProps): JSX.Element;
```
