**Input** — a single-line text field.

```jsx
<Input placeholder="Email address" type="email" />
<Input leadingIcon={<Icon name="search" />} placeholder="Search" />
<Input invalid defaultValue="nope" trailingIcon={<Icon name="circle-alert" />} />
```

`size` `sm | md | lg`; `invalid` for errors; `leadingIcon` / `trailingIcon`. All native input props pass through. Pair with a label + helper text in your form layout.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A single-line text field. Supports leading/trailing icons and an error state. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Error styling + aria-invalid. */
  invalid?: boolean;
  /** Icon node shown at the start of the field. */
  leadingIcon?: React.ReactNode;
  /** Icon node shown at the end of the field. */
  trailingIcon?: React.ReactNode;
}

export declare function Input(props: InputProps): JSX.Element;
```
