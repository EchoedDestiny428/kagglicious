"""Scan ladder replays for failed HIREs (ordered hires that did not produce a hand) by either player.

  python hire_fail.py DIR [DIR ...]

Per game: result, cash gap, and for us / the rival the days on which fewer hands arrived than HIREs were ordered.
"""
import json, pathlib, sys
from multiprocessing import Pool


def scan(args):
    path, me = args
    rep = json.load(open(path)); st = rep["steps"]
    fails = {me: [], 1 - me: []}
    for t in range(len(st) - 1):
        for p in (0, 1):
            mk = (st[t + 1][p].get("action") or {}).get("market") or []
            n = sum(1 for o in mk if o and o[0] == "HIRE")
            if not n:
                continue
            before = len(st[t][0]["observation"]["farms"][p].get("hands") or [])
            if t % 24 == 0:
                before = 0          # hands are removed at day end; hires at hour 0 start from zero
            after = len(st[t + 1][0]["observation"]["farms"][p].get("hands") or [])
            if after - before < n:
                fails[p].append((t // 24, t % 24, n - (after - before), round(st[t][0]["observation"]["farms"][p]["money"])))
    return path.stem, fails[me], fails[1 - me]


def main():
    jobs, meta = [], {}
    for d in sys.argv[1:]:
        for l in (pathlib.Path(d) / "results.jsonl").read_text().splitlines():
            r = json.loads(l)
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if p.exists() and r["seat"] >= 0 and r["result"] in ("W", "L") and r["opponent"] not in ("clove instalocker", "lost"):
                jobs.append((p, r["seat"]))
                meta[p.stem] = (r["result"], r["rewards"][r["seat"]] - r["rewards"][1 - r["seat"]], r["opponent"])
    with Pool(8) as pool:
        out = pool.map(scan, jobs)
    n_us = n_op = 0
    agg = {"us_fail": [0, 0], "op_fail": [0, 0], "none": [0, 0]}
    for ep, fu, fo in out:
        res, gap, opp = meta[ep]
        early_u = [f for f in fu if f[0] <= 7]
        early_o = [f for f in fo if f[0] <= 7]
        key = "us_fail" if early_u else "op_fail" if early_o else "none"
        agg[key][0] += res == "W"; agg[key][1] += 1
        if early_u or early_o:
            print(f"{ep} {res} gap {gap:+8.0f} vs {opp[:20]:20s} us {early_u}  rival {early_o}")
    print("\nfailed hire in days 0-7 (day, hour, missing, cash before):")
    for k, (w, n) in agg.items():
        print(f"  {k:8s} {w}/{n} won")


if __name__ == "__main__":
    main()
