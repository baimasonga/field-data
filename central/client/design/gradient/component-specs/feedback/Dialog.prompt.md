**Dialog** — a modal for focused tasks and confirmations. Controlled via `open`; closes on scrim click, the × button, or Escape.

```jsx
<Dialog open={open} onClose={close} title="Delete project?"
  description="This can't be undone."
  footer={<>
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button variant="danger" onClick={confirm}>Delete</Button>
  </>}>
  Everything in <b>Aurora</b> will be permanently removed.
</Dialog>
```

`size` `sm | md | lg`; `showClose` toggles the × ; put actions in `footer`. Keep dialogs short — one decision each.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * A centered modal dialog with scrim, entrance animation, Escape-to-close, and
 * click-outside-to-close. Render it conditionally and control it with `open`.
 */
export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Called on scrim click, close button, or Escape. */
  onClose?: () => void;
  /** Heading text. */
  title?: React.ReactNode;
  /** Sub-heading under the title. */
  description?: React.ReactNode;
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Show the top-right close button. @default true */
  showClose?: boolean;
  /** Footer node — typically right-aligned Buttons. */
  footer?: React.ReactNode;
  /** Body content. */
  children?: React.ReactNode;
}

export declare function Dialog(props: DialogProps): JSX.Element | null;
```
