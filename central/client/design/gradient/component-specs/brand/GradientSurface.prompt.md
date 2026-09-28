**GradientSurface** — an atmospheric brand panel. Use for one hero or CTA band per page; keep the rest of the layout on the neutral canvas.

```jsx
<GradientSurface gradient="mesh" style={{ padding: 48 }}>
  <h2 style={{ fontSize: 40 }}>Ship something beautiful</h2>
  <Button variant="secondary">Get started</Button>  {/* adapts to dark */}
</GradientSurface>
```

`gradient`: `halo` (barely-there wash on light) · `aurora` (vivid) · `dusk` / `mesh` (dark). Dark variants flip nested components to the dark palette via `data-theme`. Pad it yourself. One gradient surface per view.

## Props contract (reference)

The original React contract, kept here as the authoritative list of variants,
states and defaults. Port the intent to Vue — do not copy the code.

```ts
import * as React from 'react';

/**
 * A full-bleed atmospheric panel painted with a signature gradient — for heroes,
 * CTA bands, and brand moments. Dark variants set `data-theme="dark"`, so nested
 * Gradient components automatically adopt the dark palette.
 */
export interface GradientSurfaceProps extends React.HTMLAttributes<HTMLElement> {
  /** Which wash. `halo` (subtle, light) · `aurora` (vivid) · `dusk`/`mesh` (dark). @default 'mesh' */
  gradient?: 'halo' | 'aurora' | 'dusk' | 'mesh';
  /** Corner radius token or CSS length. @default 'xl' */
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | (string & {});
  /** Element to render. @default 'div' */
  as?: React.ElementType;
  children?: React.ReactNode;
}

export declare function GradientSurface(props: GradientSurfaceProps): JSX.Element;
```
