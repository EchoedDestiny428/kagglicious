# For each fetched v11.3 game: wheat lots (orders >= 30 units) of us and the rival, and on turns where both place one,
# whose order sits in the earlier slot (buy turns and sell turns separately). Prints a sample turn for the big losses.
import gc, json, pathlib, sys
from collections import Counter
for p in sorted(pathlib.Path(sys.argv[1]).glob("*.json")):
    rep = json.load(open(p, encoding="utf-8"))
    names = rep["info"]["TeamNames"]
    if "clove instalocker" not in names:
        continue
    me = names.index("clove instalocker"); st = rep["steps"]
    margin = rep["rewards"][me] - rep["rewards"][1 - me]
    lots = [0, 0]; units = [0, 0]; buy = Counter(); sell = Counter(); sample = None
    for t in range(144, 712):
        acts = [(st[t + 1][s].get("action") or {}).get("market") or [] for s in (me, 1 - me)]
        idx = {}
        for kind in ("BUY_PRODUCT", "SELL"):
            pos = []
            for a in acts:
                i = next((i for i, o in enumerate(a) if o and len(o) >= 3 and o[0] == kind and o[1] == "WHEAT" and int(o[2]) >= 30), None)
                pos.append(i)
            idx[kind] = pos
            if kind == "BUY_PRODUCT":
                for k in (0, 1):
                    if pos[k] is not None:
                        lots[k] += 1; units[k] += sum(int(o[2]) for o in acts[k] if o and len(o) >= 3 and o[0] == kind and o[1] == "WHEAT")
            if pos[0] is not None and pos[1] is not None:
                c = buy if kind == "BUY_PRODUCT" else sell
                c["us first" if pos[0] < pos[1] else "rival first" if pos[1] < pos[0] else "same slot"] += 1
                if sample is None and pos[1] < pos[0]:
                    sample = (t, kind, acts[0], acts[1])
    tag = "BIG LOSS" if margin < -3000 else ("loss" if margin < 0 else "win")
    print(f"{p.stem} {tag:8s} {int(margin):7d} vs {names[1 - me][:16].encode('ascii', 'replace').decode():16s} | lots us {lots[0]} ({units[0]}) rival {lots[1]} ({units[1]}) | buy slots {dict(buy)} | sell slots {dict(sell)}")
    if sample and margin < -3000:
        t, kind, a, b = sample
        print(f"      e.g. d{t // 24} h{t % 24} {kind}: US {a}")
        print(f"                         RIVAL {b}")
    del rep, st; gc.collect()
