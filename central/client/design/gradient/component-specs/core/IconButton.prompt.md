**IconButton** — an icon-only control for toolbars, card corners, and nav. Requires an accessible `label`.

```jsx
<IconButton label="Settings"><Icon name="settings" /></IconButton>
<IconButton variant="secondary" round label="Add"><Icon name="plus" /></IconButton>
```

Variants `ghost | secondary | primary | gradient`; sizes `sm | md | lg`; `round` for a circle. The icon auto-scales to the button size.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A square/round button holding a single icon. Always pass `label` for a11y. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** @default 'ghost' */
  variant?: 'ghost' | 'secondary' | 'primary' | 'gradient';
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Fully rounded (pill/circle) instead of the soft square. */
  round?: boolean;
  /** Accessible label — required, since there is no visible text. */
  label: string;
  /** The icon node. */
  children?: React.ReactNode;
}

export declare function IconButton(props: IconButtonProps): JSX.Element;
```
