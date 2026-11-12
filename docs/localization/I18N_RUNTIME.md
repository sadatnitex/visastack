# Bengali Runtime: How It Works

The language switch (`LANGUAGE_CHOICE_ENABLED` in `apps/web/src/lib/language-choice.ts`) is off, so every visitor sees English. Everything below is built and tested but shows no Bengali until the switch is turned on.

## Adding a catalogue for a surface

1. Create `apps/web/src/i18n/<surface>.ts` and export `<surface>Catalog = defineCatalog({ en: {...}, bn: {...} })` from `@visastack/i18n`. English defines the keys. `bn` may be partial; a missing Bengali key shows the English text.
2. Key names follow `surface.component.slot`, each part in lower camel case, for example `documents.uploadCard.title`.
3. Bengali text is not written from scratch. Look up the English term in `docs/localization/VISASTACK_TRANSLATION_REGISTER.csv`, find its `semantic_group`, and use its `bn_BD_draft` wording so one idea reads the same everywhere. Check the row's `review_state` first; only wording a qualified reviewer has approved goes live.
4. Messages: `{name}` inserts a value; `{count, plural, one {# file} other {# files}}` picks a form by number (`#` is the number, shown in the language's own digits). Never join sentences from pieces; put the whole sentence in one message.
5. Money keeps the ISO code beside the amount and is never converted: use `formatMoney(amount, 'GBP', locale)`. Numbers and dates: `formatNumber`, `formatDate`. English formats as `en-GB`, Bengali as `bn-BD`.

## Using a catalogue

- Server component that is `async`: `const t = await getT(catalog)`.
- Sync server component: `const t = getServerT(catalog)`. This needs the locale to be read first. Layouts and pages render in parallel, so every `page.tsx` default export must `await primeLocale()` before it returns. Without it `getServerT` throws under `next dev` and quietly uses English elsewhere (unit tests included). A test (`apps/web/src/lib/i18n-prime-guard.test.ts`) fails the build if a page that reaches `getServerT` does not await `primeLocale()`.
- Client component: `const t = useT(catalog)`; `useLocale()` gives the locale. The root layout wraps the page in `I18nProvider`, so no setup is needed per page.

## Checks that run

`packages/i18n` tests require every Bengali message to have exactly the same placeholders as its English message, to be NFC-normalised, and to contain no em dash.

## Turning it on, and back off

Activation: change `LANGUAGE_CHOICE_ENABLED` to `true` in a reviewed pull request, only after the owner's explicit word. Rollback: revert that pull request; every visitor returns to English at once and nothing stored needs cleaning up.
