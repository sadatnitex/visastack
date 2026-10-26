# usage (during a merge of origin/main with a conflict in globals.css):
#   python3 -I scripts/agent/merge-css.py
# Never resolve globals.css hunks by concatenating sides: a hunk can split a rule.
# Replay the branch's own globals.css changes (since the merge base) onto main's file:
# mid-file hunks by exact unique replacement, the final pure-addition hunk appended at the end.
import re, subprocess, sys
p = 'apps/web/src/app/globals.css'
base = subprocess.run(['git','merge-base','HEAD','MERGE_HEAD'],capture_output=True,text=True).stdout.strip()
patch = subprocess.run(['git','diff','-U3',base,'HEAD','--',p],capture_output=True,text=True).stdout
css = subprocess.run(['git','show','MERGE_HEAD:'+p],capture_output=True,text=True).stdout
hunks = re.split(r'^(?=@@ )', patch, flags=re.M)[1:]
tail = []
for i, h in enumerate(hunks):
    lines = h.split('\n')[1:]
    adds = [l[1:] for l in lines if l[:1] == '+']
    dels = [l for l in lines if l[:1] == '-']
    if i == len(hunks) - 1 and adds and not dels:
        tail = adds; continue
    old = '\n'.join(l[1:] for l in lines if l[:1] in (' ', '-')).rstrip('\n')
    new = '\n'.join(l[1:] for l in lines if l[:1] in (' ', '+')).rstrip('\n')
    if css.count(old) != 1: sys.exit(f'hunk {i}: context found {css.count(old)} times')
    css = css.replace(old, new, 1)
if tail: css = css.rstrip('\n') + '\n\n' + '\n'.join(tail).strip('\n') + '\n'
open(p, 'w', encoding='utf-8').write(css)
print('replayed', len(hunks), 'hunks; appended', len(tail), 'lines')
