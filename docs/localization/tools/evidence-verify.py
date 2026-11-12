# Re-fetches every product-attested evidence row and writes VISASTACK_PLATFORM_LANGUAGE_EVIDENCE.csv.
# Firefox rows: the Bengali text must appear in the raw string file. Google rows: the Bengali text must
# appear in the page source of the signed-out page (redirects followed). Nothing is accepted on trust.
import csv, html, re, subprocess

def fetch(url, follow=False):
    cmd = ['curl', '-sS', '--max-time', '60', '-A', 'Mozilla/5.0'] + (['-L'] if follow else []) + [url]
    t = subprocess.run(cmd, capture_output=True, text=True).stdout
    t = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), t)
    t = re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m.group(1), 16)), t)
    return html.unescape(t)

def norm(s): return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', s.lower())).strip()

def intent_match(intent, ext_en):
    if not ext_en: return 'NO_ENGLISH_ON_SAME_PRODUCT'
    ext = norm(ext_en)
    alts = [norm(a) for a in re.split(r'\s*/\s*', intent)]
    if ext in alts: return 'EXACT'
    iw = set(norm(intent.replace('/', ' ')).split())
    if iw and iw <= set(ext.split()): return 'RELATED_CONTAINS_INTENT_WORDS'
    return 'LOOSE'

with open('data/PLATFORM_LANGUAGE_EVIDENCE.raw.csv', encoding='utf-8') as fh:
    rows = list(csv.DictReader(fh))
cache, out, stats = {}, [], {}
for r in rows:
    rep, q, recheck = r['evidence_quality'], r['evidence_quality'], 'N/A'
    follow = r['platform'] == 'Google'
    if r['platform'] in ('Firefox', 'Google') and rep in ('OFFICIAL_STRING_RESOURCE', 'DIRECT_SCREEN'):
        key = (r['url'], follow)
        if key not in cache: cache[key] = fetch(r['url'], follow)
        ok = r['external_text'].strip() in cache[key]
        recheck = 'BENGALI_TEXT_REPRODUCED' if ok else 'NOT_REPRODUCED'
        if not ok: q = 'UNVERIFIED'
    kind = {'Firefox': 'official string resource file (raw)', 'Google': 'signed-out public page source, hl=bn'}.get(r['platform'], 'not read')
    im = intent_match(r['intent_en'], r['external_english']) if q in ('OFFICIAL_STRING_RESOURCE', 'DIRECT_SCREEN') else ''
    out.append({**r, 'reported_quality': rep, 'evidence_quality': q, 'recheck': recheck, 'source_kind': kind, 'intent_match': im})
    stats[(r['platform'], q, recheck, im)] = stats.get((r['platform'], q, recheck, im), 0) + 1
cols = ['intent_en', 'external_english', 'external_text', 'locale', 'platform', 'page_identifier', 'url', 'capture_date', 'context', 'evidence_quality', 'reported_quality', 'recheck', 'source_kind', 'intent_match', 'notes']
with open('VISASTACK_PLATFORM_LANGUAGE_EVIDENCE.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL); w.writeheader()
    for o in out: w.writerow({c: o[c] for c in cols})
for k, v in sorted(stats.items()): print(k, v)
