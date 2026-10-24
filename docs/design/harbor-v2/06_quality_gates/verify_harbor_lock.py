#!/usr/bin/env python3
"""Read-only visual reference QA for Harbor palette, not a production app audit.
Requires playwright, tinycss2 and local Chromium (/usr/bin/chromium).
"""
from pathlib import Path
import json,hashlib,sys,re
import tinycss2
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
manifest=json.loads((R/'00_authority/LOCK_MANIFEST.json').read_text())
source=R/manifest['reference']['path']; overlay=R/manifest['colorOverride']['path']; themed=R/'05_visual_previews/C1_HARBOR_HOMEPAGE.html'
assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['reference']['sha256'], 'FROZEN source mutated'
assert hashlib.sha256(overlay.read_bytes()).hexdigest()==manifest['colorOverride']['sha256'], 'HARBOR override mutated'
allowed={'color','background','background-color','border-color','box-shadow','outline-color','fill','stroke','text-decoration-color'}
violations=[]
def scan(rules):
 for rule in rules:
  if rule.type=='qualified-rule':
   for d in tinycss2.parse_declaration_list(rule.content,skip_whitespace=True,skip_comments=True):
    if d.type=='declaration' and not(d.name.startswith('--') or d.lower_name in allowed):
     violations.append([tinycss2.serialize(rule.prelude),d.name])
  elif rule.type=='at-rule' and rule.content: scan(tinycss2.parse_rule_list(rule.content,skip_whitespace=True,skip_comments=True))
scan(tinycss2.parse_stylesheet(overlay.read_text(),skip_whitespace=True,skip_comments=True))
assert not violations, f'not color-only: {violations}'
css=overlay.read_text()
assert source.read_text().replace('</head>','<style data-c1-harbor-locked="true">\n'+css+'\n</style></head>')==themed.read_text(), 'Themed HTML not deterministically generated from C1 source + Harbor overlay'
tokens=json.loads((R/'01_tokens/HARBOR_TOKENS.json').read_text())
for k,v in tokens['authoritativePalette'].items():
 assert re.search('--c1-'+k.replace('_','-')+r':\s*'+re.escape(v)+r'\s*;',css,re.I),f'missing Harbor var: {k}'

def lum(hex):
 rgb=[int(hex[i:i+2],16)/255 for i in [1,3,5]]
 scaled=[v/12.92 if v<=0.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
 return sum(a*b for a,b in zip([.2126,.7152,.0722],scaled))
def ratio(a,b):
 x,y=sorted([lum(a),lum(b)]);return round((y+.05)/(x+.05),2)
colors=tokens['authoritativePalette'];sem=tokens['semanticTokens']
contrast={}
for name,a,b in [('CTA',colors['action_foreground'],colors['accent']),('Headline',colors['ink'],colors['paper']),('Body',colors['body_copy'],colors['paper']),('Muted',colors['muted'],colors['paper']),('Success',colors['positive'],colors['paper']),('Warning',colors['warning'],colors['paper']),('Error',sem['state.danger.fg'],colors['paper']),('On_dark','#FFFFFF',colors['stage'])]:
 contrast[name]=ratio(a,b)
 assert contrast[name]>=4.5,f'{name} insufficient contrast: {contrast[name]}'
styles=['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','textTransform','position','display','gridTemplateColumns','gridTemplateRows','flexDirection','alignItems','justifyContent','gap','rowGap','columnGap','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','borderRadius','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','transform','overflow']
js='''(styles) => ({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,items:[...document.body.querySelectorAll('*')].map((e,i)=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);const d={tag:e.tagName,classes:typeof e.className==='string'?e.className:'',box:[b.x,b.y,b.width,b.height].map(x=>Math.round(x*100)/100),styles:{}};for(const key of styles)d.styles[key]=s[key];return d})})'''
ports=[(1440,900),(1024,900),(768,900),(390,844)]
issues=[];debt=[];results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height in ports:
  def measure(path,shot=None):
   page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
   page.set_content(path.read_text(),wait_until='load')
   val=page.evaluate(js,styles)
   if shot:page.screenshot(path=str(shot),full_page=True)
   page.close();return val
  a=measure(source)
  shot=R/f'05_visual_previews/C1_HARBOR_{width}.png' if width in (1440,390) else None
  b=measure(themed,shot)
  if len(a['items'])!=len(b['items']): issues.append(f'{width}: DOM count changed')
  for i,(x,y) in enumerate(zip(a['items'],b['items'])):
   if x['tag']!=y['tag'] or x['classes']!=y['classes']:issues.append(f'{width}: DOM tag/class drift node {i}')
   if any(abs(l-r)>0.5 for l,r in zip(x['box'],y['box'])):issues.append(f'{width}: geometry drift node {i} {x["box"]}→{y["box"]}')
   diff=[k for k in styles if x['styles'][k]!=y['styles'][k]]
   if diff:issues.append(f'{width}: non-color style drift node {i}: {diff}')
  sourceOverflow=a['scrollWidth']>width+1;themeOverflow=b['scrollWidth']>width+1
  if sourceOverflow!=themeOverflow:issues.append(f'{width}: overflow changed')
  if sourceOverflow:debt.append({'width':width,'issue':'Original C1 has horizontal overflow; must be corrected in production with documented exception'})
  results.append({'viewport':[width,height],'nodes':len(a['items']),'computedProperties':len(styles),'sourceOverflow':sourceOverflow,'harborOverflow':themeOverflow})
 browser.close()
report={'status':'PASS' if not issues else 'FAIL','referenceSha256':manifest['reference']['sha256'],'overrideSha256':manifest['colorOverride']['sha256'],'contrast':contrast,'screens':results,'issues':issues,'knownSourceDebt':debt,'caveat':'C1 structural/color regression only. This is not a live VisaStack app or security audit.'}
(R/'06_quality_gates/QA_REPORT.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if issues:sys.exit(1)
