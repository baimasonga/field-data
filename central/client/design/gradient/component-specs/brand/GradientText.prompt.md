**GradientText** — the signature emphasis treatment: a gradient clipped into the text. Use once per view, on the brand name or a single key word.

```jsx
<h1 style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.03em' }}>
  Designed on a <GradientText>gradient</GradientText>.
</h1>
```

`gradient` accepts `text` (default) `aurora | spectrum | iris` or any CSS gradient. Render as a heading via `as="h1"`. Don't gradient whole paragraphs — it kills legibility and the effect.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * Clips a signature gradient into the text fill. Reserve for ONE phrase per
 * view — the brand name or a single hero verb; everything else stays ink.
 */
export interface GradientTextProps extends React.HTMLAttributes<HTMLElement> {
  /** Named gradient token, or any CSS gradient string. @default 'text' */
  gradient?: 'text' | 'aurora' | 'spectrum' | 'iris' | (string & {});
  /** Element to render. @default 'span' */
  as?: React.ElementType;
  children?: React.ReactNode;
}

export declare function GradientText(props: GradientTextProps): JSX.Element;
```
