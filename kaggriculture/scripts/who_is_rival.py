"""Which known agent is the rival? For each close ladder loss (gap < $2k) in the given replay dirs, shadow-run every
candidate agent in the rival's seat (shadow_diff.play: feed it the rival's own observations) and count the steps where
its action differs from the rival's. A candidate with 0 differing steps plays exactly like the rival.

  python who_is_rival.py DIR [DIR ...] --cands A.py B.py ... [--workers 16] [--max-gap 2000]
"""
import argparse, json, os, pathlib, sys
from multiprocessing import Pool

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from shadow_diff import play  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--cands", nargs="+", required=True)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--max-gap", type=float, default=2000)
    ap.add_argument("--all", action="store_true", help="every decided game, wins included")
    ap.add_argument("--last", type=int, default=0, help="only the newest N games per dir")
    a = ap.parse_args()
    games = []
    for d in a.dirs:
        rows = sorted((json.loads(l) for l in open(os.path.join(d, "results.jsonl"))), key=lambda r: r["episode"])
        for r in rows[-a.last:] if a.last else rows:
            if r.get("result") not in ("W", "L") or r.get("seat", -1) < 0 or r.get("opponent") == "clove instalocker":
                continue
            gap = r["rewards"][1 - r["seat"]] - r["rewards"][r["seat"]]
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if p.exists() and (a.all or (r["result"] == "L" and 0 < gap < a.max_gap)):
                games.append((p, 1 - r["seat"], r["opponent"], gap))
    jobs = [(c, p, s) for p, s, _, _ in games for c in a.cands]
    with Pool(a.workers) as pool:
        out = pool.map(play, jobs)
    res = {(j[0], str(j[1])): o for j, o in zip(jobs, out)}
    names = [os.path.basename(c)[:-3] for c in a.cands]
    print(f"{'episode':10s} {'rival':18s} {'gap':>6s}  " + "  ".join(f"{n[:14]:>14s}" for n in names))
    for p, s, opp, gap in games:
        cells = []
        for c in a.cands:
            d = res[(c, str(p))]["diffs"]
            cells.append(f"{len(d):4d}@{d[0]['t'] if d else '-':>4}")
        print(f"{p.stem:10s} {opp[:18]:18s} {gap:6.0f}  " + "  ".join(f"{x:>14s}" for x in cells))
    print("cells: differing steps @ first differing step")
    print("record by how closely the rival matches each candidate (differing steps; gap > 0 = loss):")
    for c, n in zip(a.cands, names):
        for lo, hi in ((0, 8), (9, 30), (31, 120), (121, 10000)):
            m = [g for g in games if lo <= len(res[(c, str(g[0]))]["diffs"]) <= hi]
            print(f"  {n:16s} {lo:4d}-{hi:<5d} games {len(m):3d}  losses {sum(g[3] > 0 for g in m):3d}")


if __name__ == "__main__":
    main()
