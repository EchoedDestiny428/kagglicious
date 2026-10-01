"""Record of a family of teams by opponent type, where the opponent type is read from its step-0 market orders.

  python family_vs.py DIR [DIR ...]
"""
import json, pathlib, sys
from collections import Counter, defaultdict

V13 = {json.dumps([["BUY_PRODUCT", "WHEAT", 20], ["SELL", "WHEAT", 15], ["BUY_SEED", "WHEAT", 1]]),
       json.dumps([["BUY_PRODUCT", "WHEAT", 20], ["SELL", "WHEAT", 15]])}
COW = {json.dumps([["BUY_ANIMAL", "COW", 1], ["BUY_PRODUCT", "WHEAT", 5]]),
       json.dumps([["BUY_PRODUCT", "WHEAT", 5], ["BUY_ANIMAL", "COW", 1]])}
seen = set()
rec = defaultdict(lambda: [0, 0, []])
for d in sys.argv[1:]:
    for l in (pathlib.Path(d) / "seats.jsonl").read_text().splitlines():
        r = json.loads(l)
        key = (r["episode"], r.get("team"))
        p = pathlib.Path(d) / f"{r['episode']}.json"
        if key in seen or not p.exists():
            continue
        seen.add(key)
        rep = json.load(open(p))
        s = int(r["seat"]); o = 1 - s
        op0 = json.dumps((rep["steps"][1][o].get("action") or {}).get("market") or [])
        kind = "v13-public" if op0 in V13 else "cow-family" if op0 in COW else "other"
        rw = rep["rewards"]
        rec[kind][0] += rw[s] > rw[o]; rec[kind][1] += 1; rec[kind][2].append(rw[s] - rw[o])
for k, (w, n, g) in rec.items():
    g.sort()
    print(f"vs {k:11s}: {w}/{n} won ({100 * w / max(1, n):.0f}%), median margin {g[len(g) // 2]:+.0f}")
