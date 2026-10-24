// Programme X WP-A0 baseline tool. Read-only: writes only to the path given. Usage is in docs/upgrades/programme/A0-AUDIT.md.
// Builds the corrected landing preview from the frozen Harbor homepage.
// Deterministic: same source in, same preview out. Docs only, not production code.
const fs = require('node:fs');
const [src, out] = process.argv.slice(2);
const dash = String.fromCharCode(0x2014);
let html = fs.readFileSync(src, 'utf8');
const swaps = [
  // D5: phone bottom tab says Record, not Documents.
  ['<span>▤ Documents</span>', '<span>▤ Record</span>'],
  // D5: Prepare again (U02) has not shipped, so the float shows a reminder that exists today.
  [
    '<b>Prepared again, faster</b><small>Reuse a selected document</small>',
    '<b>Reminder before it expires</b><small>Passport · sample record</small>',
  ],
  ['<div class="float-icon">⇪</div>', '<div class="float-icon">◷</div>'],
  // House rule: no long dashes. Copy itself is rewritten in WP-L1.
  [
    `VisaStack ${dash} Flighty-inspired Concept 1`,
    'VisaStack - landing preview with signed corrections',
  ],
  [`you choose${dash}within`, 'you choose, within'],
  // D4: phone menu reusing the site navigation links (disclosure, no script).
  [
    '<div class="rightlinks">',
    '<details class="pv-menu"><summary aria-label="Menu">Menu</summary><nav aria-label="Site"><a href="#record">Product</a><a href="#agency">For agencies</a><a href="#privacy">Privacy &amp; control</a><a href="#how">How it works</a><a href="https://vs.obsidianglobal.studio/">Sign in</a></nav></details><div class="rightlinks">',
  ],
];
for (const [a, b] of swaps) {
  if (!html.includes(a)) throw new Error(`missing source text: ${a}`);
  html = html.replace(a, b);
}
const css = `
/* OWNER-EXTENSION begin: D4 signed corrections, preview only */
.pv-menu{display:none;position:relative}
.pv-menu summary{list-style:none;cursor:pointer;min-height:44px;min-width:44px;display:flex;align-items:center;padding:0 12px;border:1px solid currentColor;border-radius:999px;font-size:15px}
.pv-menu summary::-webkit-details-marker{display:none}
.pv-menu nav{position:absolute;right:0;top:52px;z-index:20;display:flex;flex-direction:column;min-width:220px;padding:8px;border-radius:16px;background:var(--c1-paper);border:1px solid var(--c1-ink)}
.pv-menu nav a{min-height:44px;display:flex;align-items:center;padding:0 12px;color:var(--c1-ink);text-decoration:none}
@media(max-width:900px){
 .links{display:none}.pv-menu{display:block}.rightlinks .signin{display:none}
 .devices{height:auto;display:flex;flex-direction:column;align-items:center;gap:12px}
 .phone{position:relative;left:auto;top:auto;transform:rotate(-2.8deg);margin:0 auto 18px}
 .floatcard{position:static;transform:none;width:min(340px,100%);min-width:0}
 .fc3,.fc4{display:flex}
 .fineprint{position:static;transform:none;text-align:center;margin-top:4px}
}
@media(max-width:420px){.rightlinks .pill{display:none}.topnav{gap:8px}}
/* D15 (part of D4): smallest reposition at 901-1100px so fc1 and fc4 clear the phone. 1440 unchanged. */
@media(min-width:901px) and (max-width:1100px){.fc1{left:2%}.fc4{right:2%}}
/* OWNER-EXTENSION end */
`;
html = html.replace('</style></head>', `${css}</style></head>`);
fs.writeFileSync(out, html);
process.stdout.write(`wrote ${out}\n`);
