import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the components-lifecycle surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const componentsLifecycleCatalog = defineCatalog({
  en: {
    'componentsLifecycle.lifecycleUndoStatus.undo': 'Undo',
  },
  bn: {
    'componentsLifecycle.lifecycleUndoStatus.undo': 'ফিরিয়ে নিন',
  },
});
