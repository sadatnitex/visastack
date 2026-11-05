# VisaStack design language: the Slice

Owner instruction (5 Nov 2026): design, icons and assets must never look as if a machine made them. This page is the rule every new screen is held to. It comes from the brand mark, the Sliced V: one shape cut into stacked slices, because a record is built in layers.

## What we draw

- **Icons** (`apps/web/src/components/icons.tsx`): a clear silhouette in ink, with one blue slice, flat, 2.4 to 3 units tall, square-cut or leaning like the arms of the V. The blue slice is the signature: every object icon carries exactly one. A gesture (tick, cross, arrow, chevron) is a plain round stroke.
- **The slice rule**: two short stacked bars in a tone, in front of a label, a count or a card. It is the one way a tone shows on a card, so colour says what a thing is without painting the whole card.
- **Numbers** are set large in the tone that says what they ask (green fine, amber look at it, red act now, blue and violet and teal for kinds). Labels stay in ink.
- **Steps** are numbered "01 02 03" in the brand blue, never in circles.
- **Type** is Inter with tight display tracking, tabular numbers, and one weight step between title and body.

## What we do not draw

These are the signs of a screen made without a designer. None may appear.

1. A pale tinted card background in a colour, repeated on every card.
2. A rounded square tile behind an icon, repeated on every row.
3. A coloured line along the top or the left edge of a card.
4. A pill tag above every title.
5. Gradients, glows, shadows, glass, emoji, stock illustrations.
6. Three identical cards in a row, each with an icon, a heading and two lines.
7. An icon on every item. An icon appears only where it carries meaning the words do not.
8. Decorative copy ("Seamless", "Powerful", "Unlock"). Words say what happens.

## Colour

Six tones with their pale grounds (`WP-PLAIN-TONE` in `globals.css`); `tone-contrast.test.ts` holds every pair to 4.5:1. Blue is the brand, green means fine, amber means look at it, red means act now, violet and teal tell kinds of thing apart. A zero is green: nothing is asked.

## Checking a screen

Render it at 390 and 1440 wide. If the colour can be removed and the screen still reads, the colour is decoration; remove it. If a pattern above appears, replace it.
