**Toast** — a brief, self-dismissing notification. The component is presentational; you own the queue and where it's anchored (typically a fixed bottom-right stack).

```jsx
<Toast variant="success" title="Saved" description="Your changes are live." onClose={dismiss} />
<Toast variant="danger" title="Upload failed"
  action={<Button size="sm" variant="ghost">Retry</Button>} onClose={dismiss} />
```

Variants `info | success | warning | danger` set the icon + color. `title`, `description`, `action`, `onClose`. Keep copy to one line where possible.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * A transient notification. This is the presentational toast; wire your own
 * queue/positioning (usually a fixed bottom-right stack) around it.
 */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @default 'info' */
  variant?: 'info' | 'success' | 'warning' | 'danger';
  /** Bold first line. */
  title?: React.ReactNode;
  /** Secondary line. */
  description?: React.ReactNode;
  /** Optional action node (e.g. an "Undo" ghost Button). */
  action?: React.ReactNode;
  /** Show a dismiss button; called when clicked. */
  onClose?: () => void;
  /** Override the status icon. */
  icon?: React.ReactNode;
}

export declare function Toast(props: ToastProps): JSX.Element;
```
