"""Trace both farms' wheat orders in one ladder replay: every turn from --from-step where either side places a wheat
order of >= 10 units, with full market lists (slots matter), market wheat stock and quote, and our till.

  python wheat_trace.py REPLAY.json [--from-step 144] [--turns 40]
"""
import argparse, json
ap = argparse.ArgumentParser()
ap.add_argument("path"); ap.add_argument("--from-step", type=int, default=144); ap.add_argument("--turns", type=int, default=40)
a = ap.parse_args()
rep = json.load(open(a.path, encoding="utf-8"))
names = rep["info"]["TeamNames"]; me = names.index("clove instalocker"); st = rep["steps"]
print(names, "our seat", me, "rewards", rep["rewards"])
shown = 0
for t in range(a.from_step, len(st) - 1):
    acts = [(st[t + 1][s].get("action") or {}).get("market") or [] for s in (me, 1 - me)]
    if not any(o and len(o) >= 3 and o[1] == "WHEAT" and o[0] in ("BUY_PRODUCT", "SELL") and int(o[2]) >= 10 for x in acts for o in x):
        continue
    o0 = st[t][0]["observation"]
    print(f"d{t // 24} h{t % 24:2d} step {t} inv {o0['market']['inventory']['WHEAT']} px {o0['market']['prices']['WHEAT']} | our till {o0['farms'][me]['money']:.0f} rival {o0['farms'][1 - me]['money']:.0f}")
    print(f"      US    {acts[0]}")
    print(f"      RIVAL {acts[1]}")
    shown += 1
    if shown >= a.turns:
        break
