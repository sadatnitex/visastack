/**
 * The words that put a register row in a specialist review queue (legal, commercial, official
 * visa rule). build-register.mjs uses them for register rows, and scripts/i18n/refill.mjs for
 * drafts written for a catalogue key, so both kinds of draft land in the same queue by
 * construction. No side effects: safe to import anywhere.
 */
export const LEGAL_RE =
  /\b(consent|privacy|personal (data|information)|legal hold|legal requirement|retention|retain|erase|erasure|data protection|terms of|terms and|permanently delet\w*|audit trail|anonymi[sz]ed|lawful|withdraw consent|controller|processor)\b/i;
export const COMMERCIAL_RE =
  /\b(invoice|receipt|refund|payment|price|pricing|billing|fee|fees|checkout|subscription|credit|charge|renew\w*|currency|plan|plans|purchase|paid|quota|fair.use)\b/i;
export const OFFICIAL_RE =
  /\b(embassy|consulate|visa (rule|requirement|route|centre|center|application centre)|official (source|checklist|rule|requirement|page|website|pack)|immigration authority|checklist pack|issuing authority)\b/i;

/**
 * Every specialist queue the words alone put a text in, in precedence order (legal, commercial,
 * official). Empty means ordinary interface wording.
 * @param {string} text
 * @returns {('PRIVACY_CONSENT_LEGAL'|'COMMERCIAL'|'OFFICIAL_VISA_REQUIREMENT')[]}
 */
export function queuesByWords(text) {
  const hits = [];
  if (LEGAL_RE.test(text)) hits.push('PRIVACY_CONSENT_LEGAL');
  if (COMMERCIAL_RE.test(text)) hits.push('COMMERCIAL');
  if (OFFICIAL_RE.test(text)) hits.push('OFFICIAL_VISA_REQUIREMENT');
  return hits;
}
