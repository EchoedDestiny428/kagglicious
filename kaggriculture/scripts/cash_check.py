"""Does the early low-cash wheat lot ever starve the farm? For each fetched ladder game of ours: the lowest till we reach
on days 6-12, the number of hands we and the rival have on days 8 / 12 / 16 / 20, tiles planted on day 15, and the margin.
Prints the games where we have fewer hands than the rival or the till went under $100.

  python cash_check.py DIR [DIR ...]
"""
import gc, json, pathlib, sys
OURS = ("clove instalocker", "lost")
rows = []
for d in sys.argv[1:]:
    for p in sorted(pathlib.Path(d).glob("*.json")):
        rep = json.load(open(p, encoding="utf-8"))
        names = rep["info"]["TeamNames"]
        if not any(n in OURS for n in names) or all(n in OURS for n in names):
            continue
        me = next(i for i, n in enumerate(names) if n in OURS); st = rep["steps"]
        low = min(st[t][0]["observation"]["farms"][me]["money"] for t in range(144, 300))
        low_r = min(st[t][0]["observation"]["farms"][1 - me]["money"] for t in range(144, 300))
        hands = {dd: (len(st[dd * 24][0]["observation"]["farms"][me]["hands"]), len(st[dd * 24][0]["observation"]["farms"][1 - me]["hands"])) for dd in (8, 12, 16, 20)}
        rows.append(dict(ep=p.stem, opp=names[1 - me], margin=rep["rewards"][me] - rep["rewards"][1 - me], low=low, low_r=low_r, hands=hands,
                         status=[st[-1][i].get("status") for i in (0, 1)]))
        del rep, st; gc.collect()
print(len(rows), "games; till floor days 6-12: ours median", sorted(r["low"] for r in rows)[len(rows) // 2], "rival median", sorted(r["low_r"] for r in rows)[len(rows) // 2])
print("games with our till under $100:", sum(r["low"] < 100 for r in rows), "| rival under $100:", sum(r["low_r"] < 100 for r in rows))
bad = [r for r in rows if any(a < b for a, b in r["hands"].values())]
print("games where we have fewer hands than the rival at day 8/12/16/20:", len(bad), "| more hands:", sum(any(a > b for a, b in r["hands"].values()) for r in rows))
for r in sorted(bad, key=lambda r: r["margin"])[:14]:
    print("  ", r["ep"], int(r["margin"]), r["opp"][:16].encode("ascii", "replace").decode(), "till floor", int(r["low"]), "hands", r["hands"])
print("status other than DONE:", [(r["ep"], r["status"]) for r in rows if r["status"] != ["DONE", "DONE"]][:5])
