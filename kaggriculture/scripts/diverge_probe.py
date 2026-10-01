"""When does each opponent's play stop matching ours? Per day 0-8, the share of turns on which the rival's farmer and
hands stand on exactly our tiles, and whether the rival's farm tiles (plants/animals) match ours at the day's end.

  python diverge_probe.py OURS.py OPP.py [OPP.py ...] [--seeds 411000 411001]
"""
import argparse, contextlib, io, os, sys
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arena import _load  # noqa: E402


def kind(t):
    if isinstance(t, dict):
        return t.get("crop") or t.get("animal") or t.get("kind")
    return t


def one(job):
    ours, opp, seed, seat = job
    from kaggle_environments import make
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        a, b = _load(ours), _load(opp)
        env = make("kaggriculture", configuration={"seed": seed, "episodeSteps": 217, "actTimeout": 30}, debug=False)
        env.run([a, b] if seat == 0 else [b, a])
    st = env.steps
    out = []
    for d in range(9):
        same = seen = 0
        for t in range(d * 24 + 1, min(d * 24 + 24, len(st))):
            f = st[t][0]["observation"]["farms"]
            if f[seat].get("hands"):
                seen += 1
                same += f[seat]["farmer"] == f[1 - seat]["farmer"] and f[seat]["hands"] == f[1 - seat]["hands"]
        f = st[min(d * 24 + 23, len(st) - 1)][0]["observation"]["farms"]
        tiles = all(kind(x) == kind(y) for rx, ry in zip(f[seat]["tiles"], f[1 - seat]["tiles"]) for x, y in zip(rx, ry))
        out.append(f"{100 * same // max(1, seen):3d}{'T' if tiles else '.'}")
    return os.path.basename(opp), seed, seat, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ours"); ap.add_argument("opps", nargs="+")
    ap.add_argument("--seeds", nargs="+", type=int, default=[411000, 411001])
    a = ap.parse_args()
    jobs = [(a.ours, o, s, seat) for o in a.opps for s in a.seeds for seat in (0, 1)]
    with Pool(16) as pool:
        rows = pool.map(one, jobs)
    print("per day 0..8: % turns with identical unit positions, T = farm tiles identical at day end")
    for name, seed, seat, out in rows:
        print(f"{name:18s} {seed} s{seat}  " + " ".join(out))


if __name__ == "__main__":
    main()
