# Accessibility: what is built in, what is checked, and what is not

Owner: product engineering. Last updated: 2026-10-06 (Part 9 chunk 7).
Authority: Commercial V1 directive Part 9 sections 3 and 5.

## What we claim, and what we do not

The target is WCAG 2.2 level AA. **We do not claim it.** The directive says not to report
AA compliance from an automatic scanner alone, and nobody has yet used these screens
with a keyboard and a screen reader. What follows is what is built, what is checked
automatically and exactly how far those checks reach.

## What is built in

| Need | How it is built | Where | What fails if it is undone |
|---|---|---|---|
| Every page names itself (2.4.2) | A title template in the root layout; each page supplies its own part | `app/layout.tsx`, each `page.tsx` | `lib/page-titles.test.ts` |
| Landmarks a person can tell apart (1.3.1, 2.4.1) | Navigation bars named "Site" and "Workspace", the pilot notice is a named region ("About this version"), a skip link to the main area | `app/layout.tsx`, `app/app/app-nav.tsx`, `components/pilot-banner.tsx` | `lib/page-titles.test.ts`, whole-page scan |
| A result is announced (3.3.1, 4.1.3) | The message area is in the page before anything happens (polite for progress and success, an alert for failure), so a screen reader announces the change | `components/form-feedback.tsx` (`FormMessage`) | `lib/accessible-forms.test.ts`, form scan |
| Keyboard place is kept (2.4.3) | The submit button is `aria-disabled` while an action runs instead of `disabled`, and refuses a second click | `components/form-feedback.tsx` (`SubmitButton`) | `lib/accessible-forms.test.ts` (any button, pages and shared components), form scan |
| A problem points at the input (3.3.1) | The action names the field; the input is marked invalid, tied to the message and given focus | `FormResult.field`, `fieldProblem`, `useFocusInvalidField` | form scan (field-at-fault case for each form that can name a field) |
| Every control has a name (1.3.1, 3.3.2, 4.1.2) | A visible label, `aria-label` or `aria-labelledby`; a placeholder is not a name | every form | `lib/form-labels.test.ts` |
| A language switch says its own language (3.1.2) | `lang` on the switch button | `app/layout.tsx` | `lib/page-titles.test.ts` |
| Targets are at least 24 by 24 pixels (2.5.8) | Stylesheet rules | `app/globals.css` | `e2e/ux-public.spec.ts` (real browser) |
| A slow or dropped upload does not mislead | The form says it is working, says when it is slow, and when no answer arrives says it could not confirm whether the file arrived | `lib/resilience.ts` (`guardNetwork`), `document-uploader.tsx` | `lib/resilience.test.ts`, upload form tests |

## The automatic scan

`lib/axe.test-support.ts` renders real components and pages to markup and puts it through
axe-core inside jsdom, in the ordinary test run (no browser needed). Rules: axe's WCAG 2
A and AA, 2.1 A and AA, 2.2 AA and best-practice sets. On top of axe it checks what axe
reports only loosely or as "needs review":

- an attribute that points at an element that is not in the page (`aria-describedby`,
  `aria-labelledby`, `aria-controls`, `for` and the others);
- one id used by two elements;
- a same-page link (`href="#something"`) whose target is missing;
- for a whole page, exactly one main landmark and exactly one top-level heading.

| Test file | What it scans |
|---|---|
| `lib/axe.test.ts` | The scan itself: it is fed real mistakes on purpose (a field with no name, a button with no name, a dangling reference, a repeated id, a link to nothing, a bad role, a skipped heading) and must report each |
| `lib/a11y-forms.test.tsx` | 129 cases covering every form and action button, each in four states (waiting, working, failed, done), row-level buttons rendered twice in one tree, the field-at-fault case, and a check that nothing becomes disabled while an action runs |
| `lib/a11y-pages.test.tsx` | 15 whole public pages and page states in the real site shell (home, status in each state, route information, not found, errors, invite-only, last-resort error page) |
| `lib/form-behaviour.test.tsx` | The behaviour markup cannot show, with the real add-person form, upload form and status page running in a DOM: focus moves to the field a failed action names and the alert holds the reason, the mark clears when the next try works, a working button stays focusable and a second click is refused (nothing runs after the first finishes), the "taking longer than usual" and "could not confirm" wording appear when they should, and focus stays on "Check now" through the status page's own refresh |

### Adding a form

A guard in `a11y-forms.test.tsx` fails if a file that uses `useActionState`, or a form or
button it exports, has no case. Add the import, add a case with realistic props, say which
input names the action can report as being at fault (if any), and mark it `repeated` when
it appears once per row.

### Timing

Scans share one page and run one at a time, because axe refuses a second run while one is
going and a test that times out leaves its scan running. The scanning tests carry their own
90 second limit (the biggest screen, the profile editor, takes seconds on a fast machine and
more on a CI runner). A new heavy case inherits that limit; if one ever needs more, raise it
in the test, not in the default.

### How we know it can fail

Temporary faults in real code turned the suite red with a message that names the place:
a file input with no name, an error message that lost the id its field points at, a new
form nobody scanned, a submit button that disables itself, a status button that
disables itself, a form that stops moving focus to the field at fault, and a button that
stops refusing a second click. The scan's own tests keep the first kind honest
permanently.

### What the scan found so far

- The pilot notice at the top of every page sat outside every landmark (fixed: a named
  region).
- The last-resort error page had no main area (fixed).
- The status page's "Check now" button disabled itself during the page's own 15 second
  refresh, so a keyboard user lost their place (fixed; the guard had only looked at
  submit buttons and now looks at every button).

## What it cannot see

- **Colour contrast and layout.** jsdom has no layout. Contrast is checked in a real
  browser on the public pages and the layout fixture (`e2e/ux-public.spec.ts`, Chromium,
  light and dark). The signed-in screens were never opened in a real browser here.
- **Whether a task can be finished.** A scan finds structural faults, and the behaviour
  tests show which element has focus and what text a live region holds. Neither shows how
  a particular screen reader voices it. Only a person using a keyboard and a screen reader
  can tell whether the order, wording and announcements make sense.
- **Signed-in pages as whole pages.** Their forms are scanned as components. How headings
  and ids combine on a full signed-in page is not scanned.
- **Forms whose action does not name a field.** They describe the problem in the alert but
  do not mark one input invalid or move focus; the browser's own required-field messages
  catch the common mistakes first.

## Still owed (a person has to do these)

1. A keyboard-only pass of the nine critical flows.
2. A screen-reader pass: NVDA or JAWS on Windows, VoiceOver on iPhone and Mac, TalkBack on
   Android.
3. Real-device and Safari and Firefox checks.
4. Zoom to 200 and 400 percent, text spacing, reduced motion.
5. Whole-page scans of the signed-in screens with their data simulated.
6. Bangla accessibility, after the owner lifts the deferral of Bangla work.
