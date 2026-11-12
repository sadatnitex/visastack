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

## Preview path for browser checks (non-production only)

While `LANGUAGE_CHOICE_ENABLED` is false every visitor sees English. So that browser checks can render Bangla, `getLocale` (`apps/web/src/lib/locale.ts`, `localePreviewActive`) honours an existing `visastack_locale` cookie when all of these hold:

- `LOCALE_PREVIEW=1` is set in the server process (exactly `1`).
- `VERCEL_ENV` is not `production`.
- The host is not a production site (`isProductionSite`, checked directly, so the Render fallback is refused even if `DEPLOYMENT_MODE=development` is set there).
- The deployment mode is exactly `development`. `controlled_pilot` and `commercial` never qualify.

Anything unexpected gives English. The language picker, `setLocaleAction` and every visitor action are unchanged; only how a cookie is read changes. Never set the flag in `apps/web/vercel.json`, a Dockerfile, an env example or a workflow: `locale-preview-guard.test.ts` fails if it appears there (a later package that uses it in the browser-check workflow adds that one file to the guard's allow list in review). A localized check step needs `DEPLOYMENT_MODE=development` and `LOCALE_PREVIEW=1`, set only for that step.

## Language of parts (WCAG 3.1.2)

`<html lang>` names the language of the page (`pageLanguage` in `apps/web/src/lib/page-language.ts`). Text inside the page that is in the other language needs its own `lang`: Bengali from a catalogue on a page marked English, and English fallback text on a page marked Bengali.

- `catalogResolve(catalog, locale, key, params)` in `@visastack/i18n` returns `{ text, lang }`, where `lang` is the language actually used: `bn` when a Bengali value exists, otherwise `en`. `catalogTranslator` is built on it and behaves as before. The package has no React in it.
- The page language is worked out once per request. `primeLocale()` reads the request path and stores `pageLanguage(locale, path)` next to the locale in the same request-scoped holder. The root layout takes `<html lang>` from `getPageLanguage()` and passes the same value to `I18nProvider` as `pageLang`, so the page and the translators cannot disagree. With no request to read (a unit test) the page language is `en`.
- `getServerT`, `getT` and `useT` still return a callable string translator, and now also:
  - `t.node(key, params)`: the bare string when the message is in the page language, otherwise `<span lang="...">text</span>`. Use it for text rendered as a child.
  - `t.lang(key)`: `{}` or `{ lang }`, to spread onto an element that holds only that message, for example `<h2 {...t.lang('k')}>`.
- English is unchanged: under locale `en` every key resolves `en` and the page is `en`, so `t.node` returns the bare string and the English HTML is byte-identical (checked with `verify-english snapshot` and `compare`).
- Call sites are not converted here. A marking pass after the conversion waves merge switches JSX text from `{t('k')}` to `{t.node('k')}` across the converted screens at once. Keep `t('k')` for attributes and other plain-string uses.

### Corrections and the marking pass (appended)

Corrections to the section above, kept as notes because the docs are append-only:

- `catalogTranslator` does not behave exactly as before. A Bengali visitor's English fallback is now formatted with the language it is written in: digits and plural rules are English (`en`), not Bengali. Before, a fallback sentence under `bn` took Bengali digits. Messages with a Bengali value, and everything under `en`, are unchanged.
- The root layout takes `<html lang>` and the provider's `pageLang` from the value `primePage()` returns, not from `getPageLanguage()`. `getPageLanguage()` reads the same request-scoped holder afterwards and exists for server code that needs the answer later in the request.
- The call sites are now converted for the screens that were on main when the marking pass ran (auth, home, trust, status, invitation, app home, trips and countries). Screens added by later conversion waves are marked the same way once they merge.

The marking pass is `scripts/i18n/mark-parts.mjs` (tests in `mark-parts.test.mjs`, run by `test:node`):

- `node scripts/i18n/mark-parts.mjs --surface auth,home --dry-run` counts first; without `--dry-run` it writes and formats. `--all` takes every catalogue, `--files` takes named files, `--exclude <prefix>...` keeps paths untouched (other lanes' files), and `--node-props Component.prop,...` also rewrites a component prop that the author has already widened to `ReactNode`. A second run changes nothing.
- JSX text children `{t('k')}` (also under `?:`, `&&`, `||`, `??`) become `{t.node('k')}`.
- `aria-label`, `title`, `placeholder` and `alt` on a host element (and on `Link`) get `{...t.lang('k')}`. When the element also holds text from another key, or words written in the file, a single `lang` would be wrong for that text, so the attribute is left alone and counted as `attribute_lang_mixed`.
- An `<option>`, `<textarea>` or `<title>` cannot hold a span, so when the message is its only child the element gets the `t.lang` spread instead.
- Template literals, props of components that were not widened, and values stored before they are shown stay a plain `t()`; the report counts them by reason (`template_literal`, `component_prop`, `value_flow`).
- Known gap: a message stored in a variable or object and shown later (`value_flow`) is not marked; it is converted by hand when found.
