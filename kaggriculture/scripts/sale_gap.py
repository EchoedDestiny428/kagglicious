"""Where do close ladder games get decided? For every fetched game in the given dirs, per item: units sold and the
quantity-weighted pre-sale market price for us and for the rival, the revenue gap (rival minus us, approximated as
qty x price shown before the turn), and who sells a shared item first within a day. One replay in memory at a time.

  python sale_gap.py DIR [DIR ...] [--max-gap 2000] [--from-day 0]
"""
import argparse, gc, json, pathlib
from collections import defaultdict

OURS = ("clove instalocker", "lost")


def sells(action):
    out = []
    for i, o in enumerate((action or {}).get("market") or []):
        if o and len(o) >= 3 and o[0] == "SELL":
            try:
                out.append((i, o[1], max(0, int(o[2]))))
            except Exception:
                pass
    return out


def buys(action):
    out = []
    for o in (action or {}).get("market") or []:
        if o and len(o) >= 3 and o[0] == "BUY_PRODUCT":
            try:
                out.append((o[1], max(0, int(o[2]))))
            except Exception:
                pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--max-gap", type=float, default=2000)
    ap.add_argument("--from-day", type=int, default=0)
    a = ap.parse_args()
    agg = {k: defaultdict(lambda: [0, 0.0, 0, 0.0]) for k in ("L", "W")}   # item -> [our qty, our rev, rival qty, rival rev]
    first = {k: defaultdict(lambda: [0, 0, 0]) for k in ("L", "W")}        # item -> [we first, rival first, same step]
    late = {k: defaultdict(lambda: [0.0, 0.0]) for k in ("L", "W")}        # day -> [our rev, rival rev]
    buy = {k: defaultdict(lambda: [0, 0.0, 0, 0.0]) for k in ("L", "W")}   # item -> [our qty, our cost, rival qty, rival cost]
    wheat_day = {k: defaultdict(lambda: [0, 0, 0, 0]) for k in ("L", "W")}  # day -> [our buy, our sell, rival buy, rival sell]
    n = {"L": 0, "W": 0}
    for d in a.dirs:
        for p in sorted(pathlib.Path(d).glob("*.json")):
            rep = json.load(open(p, encoding="utf-8"))
            names = rep["info"]["TeamNames"]
            if not any(x in OURS for x in names) or all(x in OURS for x in names):
                continue
            me = next(i for i, x in enumerate(names) if x in OURS)
            gap = rep["rewards"][1 - me] - rep["rewards"][me]
            if abs(gap) > a.max_gap or gap == 0:
                continue
            k = "L" if gap > 0 else "W"
            n[k] += 1
            st = rep["steps"]
            firstsale = defaultdict(dict)   # (day, item) -> {seat: (step, index)}
            for t in range(len(st) - 1):
                day = t // 24
                if day < a.from_day:
                    continue
                prices = st[t][0]["observation"]["market"]["prices"]
                for seat in (0, 1):
                    shed = ((st[t][seat]["observation"].get("private") or {}).get("shed") or {})
                    for idx, item, q in sells(st[t + 1][seat].get("action")):
                        q = min(q, max(0, int(shed.get(item, 0))))   # an order larger than the stock sells the stock
                        if q <= 0:
                            continue
                        row = agg[k][item]
                        rev = q * float(prices.get(item, 0))
                        if seat == me:
                            row[0] += q; row[1] += rev; late[k][day][0] += rev
                        else:
                            row[2] += q; row[3] += rev; late[k][day][1] += rev
                        firstsale[(day, item)].setdefault(seat, (t, idx))
                        if item == "WHEAT":
                            wheat_day[k][day][1 if seat == me else 3] += q
                    for item, q in buys(st[t + 1][seat].get("action")):
                        row = buy[k][item]
                        cost = q * float(prices.get(item, 0))
                        if seat == me:
                            row[0] += q; row[1] += cost
                        else:
                            row[2] += q; row[3] += cost
                        if item == "WHEAT":
                            wheat_day[k][day][0 if seat == me else 2] += q
            for (day, item), v in firstsale.items():
                if len(v) == 2:
                    mine, theirs = v[me], v[1 - me]
                    first[k][item][0 if mine < theirs else 1 if theirs < mine else 2] += 1
            del rep, st
            gc.collect()
    for k in ("L", "W"):
        print(f"=== {'close losses' if k == 'L' else 'close wins'}: {n[k]} games (|gap| <= {a.max_gap:.0f}, from day {a.from_day})")
        print(f"{'item':12s} {'our qty':>8s} {'riv qty':>8s} {'our px':>7s} {'riv px':>7s} {'rev gap/game (rival-us)':>24s}   first seller in a day: us / rival / same turn+index")
        tot = 0.0
        for item, (q1, r1, q2, r2) in sorted(agg[k].items(), key=lambda kv: -(kv[1][3] - kv[1][1])):
            g = (r2 - r1) / max(1, n[k]); tot += g
            f = first[k][item]
            print(f"{item:12s} {q1 / max(1, n[k]):8.1f} {q2 / max(1, n[k]):8.1f} {r1 / max(1, q1):7.1f} {r2 / max(1, q2):7.1f} {g:24.0f}   {f[0]} / {f[1]} / {f[2]}")
        print(f"{'total':12s} {'':8s} {'':8s} {'':7s} {'':7s} {tot:24.0f}")
        print("  product purchases per game (qty @ avg pre-price): " + "  ".join(
            f"{item}: us {v[0] / max(1, n[k]):.0f}@{v[1] / max(1, v[0]):.1f} rival {v[2] / max(1, n[k]):.0f}@{v[3] / max(1, v[2]):.1f}" for item, v in sorted(buy[k].items())))
        for item in ("WHEAT", "FERTILIZER"):
            b, s_ = buy[k][item], agg[k][item]
            print(f"  {item} net (sales - purchases) per game: us {(s_[1] - b[1]) / max(1, n[k]):+.0f}  rival {(s_[3] - b[3]) / max(1, n[k]):+.0f}")
        print("  wheat per game by day (our buy/sell | rival buy/sell): " + "  ".join(
            f"d{day}:{v[0] / max(1, n[k]):.0f}/{v[1] / max(1, n[k]):.0f}|{v[2] / max(1, n[k]):.0f}/{v[3] / max(1, n[k]):.0f}" for day, v in sorted(wheat_day[k].items())))
        print("  revenue gap per game by day (rival-us): " + "  ".join(f"d{day}:{(v[1] - v[0]) / max(1, n[k]):+.0f}" for day, v in sorted(late[k].items())))


if __name__ == "__main__":
    main()
