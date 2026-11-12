# Attaches observed wording to the core glossary and classifies how each term was obtained.
#   OBSERVED_EXACT_FORM      the proposed wording appears in a verified row whose English matches the intent exactly
#   OBSERVED_DIFFERENT_FORM  a verified row matches the intent exactly but uses different Bengali; editor chooses
#   OBSERVED_RELATED_ONLY    only verified rows with similar or loose English (same word, not the same meaning)
#   LLM_RECOMMENDATION       nothing observed; wording proposed by a language model and not verified against any product
import csv, collections, re, unicodedata
with open('VISASTACK_PLATFORM_LANGUAGE_EVIDENCE.csv', encoding='utf-8') as fh:
    ev = [r for r in csv.DictReader(fh) if r['evidence_quality'] in ('OFFICIAL_STRING_RESOURCE', 'DIRECT_SCREEN', 'BILINGUAL_OFFICIAL_PAGE')]
by = collections.defaultdict(list)
for r in ev: by[r['intent_en'].strip().lower()].append(r)
with open('data/BN_BD_CORE_GLOSSARY.csv', encoding='utf-8') as fh:
    g = list(csv.DictReader(fh))
clean = lambda s: unicodedata.normalize('NFC', s).replace('\u200c', '').replace('\u200d', '').strip().rstrip('\u2026.: ')
count = collections.Counter()
for t in g:
    hits = by.get(t['english'].strip().lower(), [])
    if not hits:
        count['LLM_RECOMMENDATION'] += 1
        continue
    exact = [h for h in hits if h['intent_match'] == 'EXACT']
    prop = clean(t['bn_bd_proposed'])
    def forms(rows):
        d = collections.OrderedDict()
        for h in rows: d.setdefault(clean(h['external_text']), []).append(f"{h['platform']}:{h['page_identifier'] or h['url'][-30:]}")
        return d
    if exact:
        d = forms(exact)
        t['observed_forms'] = ' | '.join(f"{v} [{h[0]}{' +%d more' % (len(h) - 1) if len(h) > 1 else ''}]" for v, h in list(d.items())[:4])
        same = any(prop == v or prop in (v + ' \u0995\u09b0\u09c1\u09a8', v + ' \u09a6\u09bf\u09a8') for v in d)
        t['attestation_class'] = 'OBSERVED_EXACT_FORM' if same else 'OBSERVED_DIFFERENT_FORM'
        if same: t['evidence_quality'] = exact[0]['evidence_quality']
        t['attested_by'] = 'exact-intent rows: ' + ', '.join(sorted({h['platform'] for h in exact}))
    else:
        d = forms(hits)
        t['observed_forms'] = ' | '.join(f"{v} [{h[0]}]" for v, h in list(d.items())[:3])
        t['attestation_class'] = 'OBSERVED_RELATED_ONLY'
        t['attested_by'] = 'related rows only (same word, not the same meaning): ' + ', '.join(sorted({h['platform'] for h in hits}))
    count[t['attestation_class']] += 1
cols = list(g[0].keys())
with open('data/BN_BD_CORE_GLOSSARY.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(g)
print('terms', len(g), dict(count))
