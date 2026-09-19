**Tag** — a content label or filter chip. Softer-cornered than Badge and optionally interactive/removable.

```jsx
<Tag>Design</Tag>
<Tag onClick={toggle} selected={on} leadingIcon={<Icon name="hash" />}>Filter</Tag>
<Tag onRemove={() => remove(id)}>Removable</Tag>
```

`size` `sm | md`; `selected` for active filters; `onClick` makes it a button; `onRemove` renders a "×". Use **Badge** for non-interactive status pills.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/** A content/filter chip. Interactive when `onClick` is set; removable via `onRemove`. */
export interface TagProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'> {
  /** @default 'md' */
  size?: 'sm' | 'md';
  /** Selected (accent) state — for filter chips. */
  selected?: boolean;
  /** Leading icon node. */
  leadingIcon?: React.ReactNode;
  /** Show a remove "×"; called when it is clicked. */
  onRemove?: (e: React.MouseEvent) => void;
  /** Makes the whole tag a button. */
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

export declare function Tag(props: TagProps): JSX.Element;
```
