"""When and how the rival gets ahead in our ladder losses, from the recorded observations only (no re-simulation).

  python loss_forensics.py DIR [DIR ...] [--skip-hire-fail]

Per loss: cash gap (rival - us) at the end of days 3/7/14/21/25/28/29, herd gap on days 7/14/29, animals that escaped
(an animal tile that empties while no one sells animals - the engine has no SELL for animals), owned-tile gap, and a
phase label: EARLY (rival >= $500 ahead by day 7), MID (first >= $2k ahead between days 8-25), LATE (within $2k until
day 25). Totals per phase at the end.
"""
import argparse, json, pathlib
from collections import Counter, defaultdict
from multiprocessing import Pool

TEAMS = ("clove instalocker", "lost")
DAYS = (3, 7, 14, 21, 25, 28, 29)


def farm(st, d, p):
    return st[min(d * 24 + 23, len(st) - 1)][0]["observation"]["farms"][p]


def herd(f):
    c = Counter()
    for row in f["tiles"]:
        for x in row:
            if isinstance(x, dict) and "animal" in x:
                c[x["animal"][0]] += 1
    return c


def animal_tiles(f):
    return {(x, y, t["animal"], t.get("placed_day")) for y, row in enumerate(f["tiles"]) for x, t in enumerate(row)
            if isinstance(t, dict) and "animal" in t}


def one(args):
    path, me = args
    st = json.load(open(path))["steps"]
    op = 1 - me
    cash = {d: farm(st, d, op)["money"] - farm(st, d, me)["money"] for d in DAYS}
    hg = {}
    for d in (7, 14, 29):
        a, b = herd(farm(st, d, me)), herd(farm(st, d, op))
        hg[d] = f"C{b['C'] - a['C']:+d}S{b['S'] - a['S']:+d}G{b['G'] - a['G']:+d}"
    esc = {me: [], op: []}
    for p in (me, op):
        prev = animal_tiles(farm(st, 0, p))
        for d in range(1, 30):
            cur = animal_tiles(farm(st, d, p))
            lost = prev - cur
            if lost:
                esc[p].append((d, len(lost)))
            prev = cur
    tiles = {d: sum(x != "LOCKED" for row in farm(st, d, op)["tiles"] for x in row)
             - sum(x != "LOCKED" for row in farm(st, d, me)["tiles"] for x in row) for d in (7, 14, 21, 29)}
    hands0 = [len(st[25][0]["observation"]["farms"][p].get("hands") or []) for p in (me, op)]
    first2k = next((d for d in range(1, 30) if farm(st, d, op)["money"] - farm(st, d, me)["money"] >= 2000), None)
    if cash[7] >= 500:
        phase = "EARLY"
    elif first2k is not None and first2k <= 25:
        phase = "MID"
    else:
        phase = "LATE"
    return dict(ep=path.stem, cash=cash, herd=hg, esc_us=esc[me], esc_op=esc[op], tiles=tiles, hands=hands0,
                first2k=first2k, phase=phase)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--skip-hire-fail", action="store_true")
    a = ap.parse_args()
    jobs, meta = [], {}
    for d in a.dirs:
        for l in (pathlib.Path(d) / "results.jsonl").read_text().splitlines():
            r = json.loads(l)
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if p.exists() and r["seat"] >= 0 and r["result"] == "L" and r["opponent"] not in TEAMS:
                jobs.append((p, r["seat"]))
                meta[p.stem] = (r["opponent"], r["rewards"][1 - r["seat"]] - r["rewards"][r["seat"]])
    with Pool(8) as pool:
        out = pool.map(one, jobs)
    if a.skip_hire_fail:
        out = [r for r in out if r["hands"][0] >= r["hands"][1]]
    by = defaultdict(list)
    for r in sorted(out, key=lambda r: (r["phase"], -meta[r["ep"]][1])):
        opp, gap = meta[r["ep"]]
        by[r["phase"]].append(gap)
        c = " ".join(f"d{d}:{r['cash'][d] / 1000:+.1f}" for d in DAYS)
        print(f"{r['phase']:5s} {r['ep']} {opp[:16]:16s} gap {gap:+7.0f} | cash$k {c} | herd {r['herd']} | tiles {r['tiles']} "
              f"| esc us {r['esc_us']} op {r['esc_op']} | hands@d1 {r['hands']}")
    print()
    for k, v in by.items():
        print(f"{k:5s} {len(v):3d} losses, mean gap {sum(v) / len(v):+8.0f}, <$2k: {sum(g < 2000 for g in v)}")


if __name__ == "__main__":
    main()
