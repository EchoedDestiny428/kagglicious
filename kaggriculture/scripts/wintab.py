# Win table from arena jsonl files: rows = candidates, columns = opponents (wins/games), plus total.
import json, os, sys
from collections import defaultdict
W = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for fn in sys.argv[1:]:
    for l in open(fn):
        r = json.loads(l)
        for me, you, rm, ry in (("a", "b", "ra", "rb"), ("b", "a", "rb", "ra")):
            c = W[os.path.basename(r[me])[:-3]][os.path.basename(r[you])[:-3]]
            c[0] += (r[rm] or 0) > (r[ry] or 0); c[1] += 1
opps = sorted({o for c in W.values() for o in c})
short = {o: o.replace("new_", "").replace("kaggriculture-", "").replace("the-shepherds-ledger-", "")[:12] for o in opps}
print(f"{'':16s}" + "".join(f"{short[o]:>13s}" for o in opps) + "        total")
for c in sorted(W):
    row = W[c]
    tw = sum(row[o][0] for o in opps if o != c); tg = sum(row[o][1] for o in opps if o != c)
    print(f"{c[:16]:16s}" + "".join(f"{(str(row[o][0]) + '/' + str(row[o][1])) if row[o][1] else '-':>13s}" for o in opps) + f"   {tw}/{tg} {100 * tw / max(1, tg):.0f}%")
