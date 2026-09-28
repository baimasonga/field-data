**Textarea** — a multi-line text field.

```jsx
<Textarea placeholder="Tell us more…" rows={5} />
<Textarea invalid defaultValue="" />
```

`invalid` for errors; `rows` sets the initial height. Resizes vertically. All native textarea props pass through.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A multi-line text field. Vertically resizable by default. */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Error styling + aria-invalid. */
  invalid?: boolean;
  /** @default 4 */
  rows?: number;
}

export declare function Textarea(props: TextareaProps): JSX.Element;
```
