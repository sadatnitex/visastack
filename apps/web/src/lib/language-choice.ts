/**
 * Whether people can choose a language. On since 2026-11-12 (owner decision): the owner wants to
 * see how Bangla appears and keep updating it, and sharing incomplete translation is fine, so the
 * switch shows in the header and on the account page and pages follow the saved choice
 * (`getLocale`). Anything without a Bangla message stays in English.
 * Rollback: set it back to false. The switch is hidden again, every page is English, and a choice
 * saved earlier is ignored, not deleted.
 */
export const LANGUAGE_CHOICE_ENABLED: boolean = true;
