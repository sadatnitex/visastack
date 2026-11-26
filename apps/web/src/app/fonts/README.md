# Fonts

Self-hosted so the page security policy (`font-src 'self'`) needs no change and no request leaves the product.

- `inter-latin-wght-normal.woff2`: Inter, Latin subset, variable weight. SIL Open Font License 1.1 (`INTER-LICENSE.txt`).
- `noto-sans-bengali-bengali-wght-normal.woff2`: Noto Sans Bengali, Bengali subset, variable weight. SIL Open Font License 1.1 (`NOTO-SANS-BENGALI-LICENSE.txt`).

Both come from the Fontsource packages (`@fontsource-variable/inter` 5.3.0, `@fontsource-variable/noto-sans-bengali` 5.3.0). The Bengali file is only downloaded when a page shows Bangla text.

Landing page display fonts (the approved homepage, loaded only on `/`):

- `instrument-serif-regular.ttf` and `instrument-serif-italic.ttf`: Instrument Serif, the headline face of the first screen and one section heading. SIL Open Font License 1.1 (`INSTRUMENT-SERIF-OFL.txt`).
- `space-grotesk-wght.woff2`: Space Grotesk, variable weight, the heading face of the other sections. SIL Open Font License 1.1 (`SPACE-GROTESK-OFL.txt`).

The files are the exact ones published with the approved design (checksums in the design hand-off). Body text keeps Inter and Noto Sans Bengali.
