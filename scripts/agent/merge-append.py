# usage (during a merge of origin/main with conflicts in append-only files):
#   python3 -I scripts/agent/merge-append.py docs/commercial-v1/known-issues.md
# Commit any edits to the branch's own entries BEFORE merging: uncommitted edits are lost.
# Main's file, then the branch's own additions relative to the merge base (branch must have only appended).
import subprocess, sys
def show(ref, p): return subprocess.run(['git','show',f'{ref}:{p}'],capture_output=True,text=True,check=True).stdout
base = subprocess.run(['git','merge-base','HEAD','MERGE_HEAD'],capture_output=True,text=True).stdout.strip()
for p in sys.argv[1:]:
    b = show(base, p).rstrip('\n'); mine = show('HEAD', p); main = show('MERGE_HEAD', p)
    if not mine.startswith(b): sys.exit(f'{p}: branch did not only append')
    add = mine[len(b):].strip('\n')
    open(p, 'w', encoding='utf-8').write(main.rstrip('\n') + '\n\n' + add + '\n')
    print(p, 'ok', add.count('\n') + 1, 'lines')
