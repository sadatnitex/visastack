# Adds attested wording from the verified platform evidence to the core glossary.
import csv, collections
ev = [r for r in csv.DictReader(open('VISASTACK_PLATFORM_LANGUAGE_EVIDENCE.csv', encoding='utf-8')) if r['evidence_quality'] in ('OFFICIAL_STRING_RESOURCE','DIRECT_SCREEN','BILINGUAL_OFFICIAL_PAGE')]
by = collections.defaultdict(list)
for r in ev: by[r['intent_en'].strip().lower()].append(r)
g = list(csv.DictReader(open('data/BN_BD_CORE_GLOSSARY.csv', encoding='utf-8')))
n_att = n_match = n_diff = 0
for t in g:
    key = t['english'].strip().lower()
    hits = by.get(key, [])
    if not hits:
        continue
    variants = collections.OrderedDict()
    for h in hits:
        variants.setdefault(h['external_text'].strip(), []).append(h['page_identifier'])
    shown = ' | '.join(f"{v} [{h[0]}{' +%d more' % (len(h)-1) if len(h)>1 else ''}]" for v, h in list(variants.items())[:4])
    t['attested_by'] = 'Firefox bn (related strings; same intent word, not always same meaning): ' + shown
    n_att += 1
    stems = [v for v in variants]
    base = t['bn_bd_proposed'].replace(' করুন','').replace(' দিন','')
    exact = {t['bn_bd_proposed'], base}
    if any(v.rstrip('…. ') in exact for v in stems):
        t['evidence_quality'] = 'OFFICIAL_STRING_RESOURCE'
        n_match += 1
    else:
        t['usage_note'] = (t['usage_note'] + ' ' if t['usage_note'] else '') + 'Proposed wording differs from the attested variants listed; editor to choose.'
        n_diff += 1
cols = list(g[0].keys())
with open('data/BN_BD_CORE_GLOSSARY.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(g)
print('terms', len(g), 'with attested match candidates', n_att, 'wording agrees', n_match, 'differs', n_diff)
for t in g:
    if 'differs' in t['usage_note']: print('DIFF', t['english'], '->', t['bn_bd_proposed'], '||', t['attested_by'][:110])
