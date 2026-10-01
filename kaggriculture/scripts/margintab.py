# Mean margin table from arena jsonl files: rows = candidates, columns = opponents, cell = wins/games and mean $ margin.
import json, os, sys
from collections import defaultdict
W = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0]))
for fn in sys.argv[1:]:
    for l in open(fn):
        r = json.loads(l)
        if "error" in r:
            continue
        for me, you, rm, ry in (("a", "b", "ra", "rb"), ("b", "a", "rb", "ra")):
            c = W[os.path.basename(r[me])[:-3]][os.path.basename(r[you])[:-3]]
            c[0] += (r[rm] or 0) > (r[ry] or 0); c[1] += 1; c[2] += (r[rm] or 0) - (r[ry] or 0)
opps = sorted({o for c in W.values() for o in c})
for c in sorted(W):
    print(c)
    for o in opps:
        n = W[c][o]
        if n[1]:
            print(f"    vs {o[:34]:34s} {n[0]:3d}/{n[1]:<3d}  mean margin {n[2] / n[1]:+9.0f}")
