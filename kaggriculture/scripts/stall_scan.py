"""Find days on which our units stall: per day, PASS commands and unit count for us and the rival, across ladder
replays. Flags days where our PASS share exceeds the rival's by a margin (mirror rivals run the same routes).

  python stall_scan.py DIR [DIR ...] [--margin 0.25]
"""
import argparse, json, pathlib
from collections import Counter, defaultdict
from multiprocessing import Pool

TEAMS = ("clove instalocker", "lost")


def one(args):
    path, me = args
    st = json.load(open(path))["steps"]
    out = []
    for d in range(30):
        cnt = {}
        for p in (me, 1 - me):
            n = ps = 0
            for t in range(d * 24 + 1, min((d + 1) * 24 + 1, len(st))):
                act = st[t][p].get("action") or {}
                units = [act.get("farmer") or ["PASS"]] + list(act.get("hands") or [])
                n += len(units)
                ps += sum(1 for u in units if not u or u[0] == "PASS")
            cnt[p] = (ps, n)
        out.append((d, cnt[me], cnt[1 - me]))
    return path.stem, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--margin", type=float, default=0.25)
    a = ap.parse_args()
    jobs, meta = [], {}
    for d in a.dirs:
        for l in (pathlib.Path(d) / "results.jsonl").read_text().splitlines():
            r = json.loads(l)
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if p.exists() and r["seat"] >= 0 and r["result"] in ("W", "L") and r["opponent"] not in TEAMS:
                jobs.append((p, r["seat"]))
                meta[p.stem] = (r["result"], r["rewards"][r["seat"]] - r["rewards"][1 - r["seat"]], r["opponent"])
    with Pool(8) as pool:
        res = pool.map(one, jobs)
    flagged = defaultdict(list)
    tot = Counter()
    for ep, days in res:
        for d, (pu, nu), (po, no) in days:
            if nu and no:
                tot[("us", d)] += pu / nu; tot[("op", d)] += po / no
            if nu and no and pu / nu - po / no >= a.margin and pu - po >= 10:
                flagged[ep].append((d, f"{pu}/{nu}", f"{po}/{no}"))
    print("mean PASS share per day (us / rival):")
    print("  " + " ".join(f"d{d}:{tot[('us', d)] / len(res):.2f}/{tot[('op', d)] / len(res):.2f}" for d in range(30)))
    print(f"\n{len(flagged)} games with a stall day (our PASS share >= rival + {a.margin}):")
    byday = Counter()
    for ep, fl in sorted(flagged.items(), key=lambda kv: meta[kv[0]][1]):
        res_, gap, opp = meta[ep]
        for f in fl:
            byday[f[0]] += 1
        print(f"  {ep} {res_} {gap:+8.0f} {opp[:16]:16s} {fl[:6]}")
    print("stall days histogram:", dict(sorted(byday.items())))
    w = sum(1 for ep in flagged if meta[ep][0] == "W")
    print(f"record in flagged games: {w}/{len(flagged)}")


if __name__ == "__main__":
    main()
