"""Where the cow-first family's margin over v13-base opponents comes from: re-simulate each family-vs-v13 game from both
tapes and sum revenue and spend per product, family minus opponent.

  python family_gap.py DIR [DIR ...] [--workers 4]
"""
import argparse, json, pathlib, sys
from collections import defaultdict
from multiprocessing import Pool
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from diff_replay import reproduce  # noqa: E402

V13 = {json.dumps([["BUY_PRODUCT", "WHEAT", 20], ["SELL", "WHEAT", 15], ["BUY_SEED", "WHEAT", 1]]),
       json.dumps([["BUY_PRODUCT", "WHEAT", 20], ["SELL", "WHEAT", 15]])}


def one(args):
    path, s = args
    rep = json.load(open(path))
    _, rewards, events = reproduce(rep)
    gap = defaultdict(float)
    for step, p, q, op, item, price, dlt in events:
        key = item if op == "SELL" else f"{op.lower()}:{item}"
        gap[key] += dlt if p == s else -dlt
    return path.stem, rewards[s] - rewards[1 - s], dict(gap)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+"); ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    seen, jobs = set(), []
    for d in a.dirs:
        for l in (pathlib.Path(d) / "seats.jsonl").read_text().splitlines():
            r = json.loads(l)
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if r["episode"] in seen or not p.exists():
                continue
            rep = json.load(open(p)); s = int(r["seat"])
            if json.dumps((rep["steps"][1][1 - s].get("action") or {}).get("market") or []) in V13:
                seen.add(r["episode"]); jobs.append((p, s))
    with Pool(a.workers) as pool:
        out = pool.map(one, jobs)
    tot = defaultdict(float)
    for ep, m, g in out:
        for k, v in g.items():
            tot[k] += v / len(out)
        top = sorted(g.items(), key=lambda kv: -abs(kv[1]))[:5]
        print(f"{ep} margin {m:+8.0f}  " + " ".join(f"{k}:{v:+.0f}" for k, v in top))
    print(f"\nmean per game over {len(out)} games (family minus v13 opponent):")
    for k, v in sorted(tot.items(), key=lambda kv: -abs(kv[1])):
        if abs(v) >= 100:
            print(f"  {k:24s} {v:+9.0f}")


if __name__ == "__main__":
    main()
