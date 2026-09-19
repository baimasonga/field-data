**Tabs** — a controlled tab bar. `underline` for switching page sections; `pill` for compact segmented toggles (e.g. Monthly/Yearly).

```jsx
const [tab, setTab] = React.useState('overview');
<Tabs value={tab} onChange={setTab} tabs={[
  { value: 'overview', label: 'Overview', icon: <Icon name="layout-dashboard" /> },
  { value: 'activity', label: 'Activity', badge: 3 },
  { value: 'settings', label: 'Settings' },
]} />
```

`variant` `underline | pill`; `size` `sm | md`; `fullWidth` to stretch. Each tab item takes `value`, `label`, optional `icon` / `badge` / `disabled`. You own the panel content that switches on `value`.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

export interface TabItem {
  /** Unique value emitted by onChange. */
  value: string;
  /** Visible label. */
  label: React.ReactNode;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  /** Optional trailing count/badge. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

/** A controlled tab bar. `underline` for page-level sections, `pill` for compact segmented switches. */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** The tabs to render. */
  tabs: TabItem[];
  /** Currently selected value. */
  value: string;
  /** Called with the newly selected value. */
  onChange?: (value: string) => void;
  /** @default 'underline' */
  variant?: 'underline' | 'pill';
  /** @default 'md' */
  size?: 'sm' | 'md';
  /** Stretch tabs to fill the width. */
  fullWidth?: boolean;
}

export declare function Tabs(props: TabsProps): JSX.Element;
```
