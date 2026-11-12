# Audit of the 231 drafts the automated checks flagged at PR head bd5eb8bc.
# Input: that commit's register (from git history) and today's register. Output: data/FLAGGED_AUDIT.csv
import csv, io, re, subprocess, collections

HEAD = 'bd5eb8bcfb9f337108df549050f1e0bf01f3d666'
raw = subprocess.run(['git', 'show', f'{HEAD}:docs/localization/VISASTACK_TRANSLATION_REGISTER.csv'], capture_output=True, text=True, check=True).stdout
with open('docs/localization/VISASTACK_TRANSLATION_REGISTER.csv', encoding='utf-8') as fh:
    now = {r['semantic_group']: r for r in csv.DictReader(fh)}

def flagged(r): return bool(r['bn_BD_draft']) and r['automated_checks'] not in ('', 'NOT_DRAFTED') and not r['automated_checks'].startswith('PASS')
def rules(r): return sorted({m.split(':')[0].strip() for m in r['automated_checks'].split(' ; ')})
before = [r for r in csv.DictReader(io.StringIO(raw)) if flagged(r)]

OPEN_LATIN = re.compile(r'(Settings|Calendar|File|Share|Add to Home Screen|Other calendars|From URL|Subscribe)')
rows, tally = [], collections.Counter()
for b in before:
    n = now.get(b['semantic_group'])
    en, bn0, ru = b['english'], b['bn_BD_draft'], rules(b)
    bn1 = n['bn_BD_draft'] if n else ''
    still = bool(n) and flagged(n)
    ru_now = rules(n) if still else []
    changed = bn0 != bn1
    low = en.lower()
    if 'legal hold' in low and 'আইনি কারণে সংরক্ষণ' in bn0:
        cls, why, act = 'SEMANTIC_ERROR_FIXED', 'The word for Saved (সংরক্ষণ) was used for legal hold, so a hold read as a save. Now আইনি হোল্ড.', ''
    elif low.strip() == 'checked for viruses':
        cls, why, act = 'SEMANTIC_ERROR_FIXED', 'English says checked for viruses; স্ক্যান added a scan method the English does not state. Now পরীক্ষা.', ''
    elif changed and 'version' in re.sub(r'\{[^}]*\}', ' ', low) + (' version' if re.search(r'\bv\{', low) else ''):
        cls, why, act = 'SEMANTIC_ERROR_FIXED', 'A real numbered, pack, snapshot or profile version had been written as কপি (or "copy number N"). Now সংস্করণ or স্ন্যাপশট.', ''
    elif changed:
        cls, why, act = 'TERMINOLOGY_UPDATED', 'Wording changed by the case, document and navigation term rules (ভিসা ফাইল, ডকুমেন্ট, ডকুমেন্টস).', ''
    elif not still:
        if 'STRONGER_CLAIM' in ru: why = 'Checker missed a word form (confirming, confirmations, guarantees, securely, Scans) or listed সংকেত (signal) as encryption. The draft makes no stronger claim.'
        elif 'GLOSSARY_TERM_MISSING' in ru: why = 'The term was matched inside a placeholder or typed keyword, or the draft uses an accepted synonym.'
        elif 'LATIN_LEFTOVER' in ru: why = 'Acronym, email address, URL or product name that stays in Latin letters.'
        elif 'GLOSSARY_FORBIDDEN_STEM' in ru: why = 'Cross-use rule matched an unrelated word in a long sentence.'
        else: why = 'Check was too strict for this string.'
        cls, act = 'CHECKER_FALSE_POSITIVE_REMOVED', ''
    else:
        note = n['draft_note']
        if 'PLACEHOLDER_MISMATCH' in ru_now:
            if 'ENGLISH_FRAGMENT' in note or 'runtime' in note.lower():
                cls, why, act = 'SOURCE_ISSUE_OPEN', 'The English builds part of the sentence at run time (a placeholder holds an English phrase). It cannot be fully translated until the source becomes a count-aware message.', 'Engineering: rewrite source as ICU message before Bengali release'
            else:
                cls, why, act = 'ACCEPTED_BY_DESIGN', 'An English-only plural or verb-agreement switch was dropped; Bengali does not inflect for number.', ''
        elif 'LATIN_LEFTOVER' in ru_now:
            if OPEN_LATIN.search(en):
                cls, why, act = 'OPEN_EDITOR_DECISION', 'Operating-system or app menu names are left in English. On a Bengali-language device those menus may be Bengali.', 'Editor: decide whether to show English menu names or both'
            else:
                cls, why, act = 'ACCEPTED_BY_DESIGN', 'Acronym, address or product name stays in Latin letters.', ''
        elif 'VERSION_CONCEPT_REVIEW' in ru_now:
            cls, why, act = 'ACCEPTED_DOCUMENT_HISTORY_WORDING', 'English says version; the draft says কপি because this is the history of a document, which the brief words as current copy, earlier document, exact copy. Not a numbered version.', 'Editor: confirm'
        elif 'GLOSSARY_TERM_MISSING' in ru_now:
            if 'approved' in low and 'removal' in low:
                cls, why, act = 'ACCEPTED_BY_DESIGN', 'মঞ্জুর is used for a support decision on a removal request so it cannot be read as a person approving an AI suggestion (অনুমোদন).', 'Editor: confirm'
            else:
                cls, why, act = 'ACCEPTED_BY_DESIGN', 'The draft uses a natural synonym of the glossary word; meaning is unchanged.', ''
        elif 'STRONGER_CLAIM' in ru_now:
            cls, why, act = 'ACCEPTED_BY_DESIGN', 'Idiomatic Bengali (যাচাই for a sign-in or genuineness check) matches the English meaning of check; no stronger claim.', 'Editor: confirm'
        else:
            cls, why, act = 'OPEN_EDITOR_DECISION', 'Still flagged.', 'Editor'
    tally[cls] += 1
    rows.append([b['semantic_group'], en, bn0, ' + '.join(ru), bn1, 'yes' if still else 'no', cls, why, act])

with open('docs/localization/data/FLAGGED_AUDIT.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['semantic_group', 'english', 'draft_at_bd5eb8bc', 'rules_at_bd5eb8bc', 'draft_now', 'still_flagged', 'classification', 'rationale', 'editor_action'])
    w.writerows(rows)
print(len(before), 'flagged at', HEAD[:8])
for k, v in tally.most_common(): print(' ', k, v)
