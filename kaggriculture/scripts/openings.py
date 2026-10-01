"""Step-0 and step-1 market orders of many agent files on one fresh game, to find which public agents share an opening.

  python openings.py FILE [FILE ...] [--seed 201000]
"""
import argparse, contextlib, io, json, os, sys
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arena import _load  # noqa: E402

SEED = 201000


def one(path):
    try:
        from kaggle_environments import make
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            a, b = _load(path), _load(path)
            env = make("kaggriculture", configuration={"seed": SEED, "episodeSteps": 3, "actTimeout": 30}, debug=False)
            env.run([a, b])
        st = env.steps
        return path, json.dumps((st[1][0].get("action") or {}).get("market")), json.dumps((st[2][0].get("action") or {}).get("market"))
    except Exception as e:
        return path, "ERROR " + repr(e)[:80], ""


def main():
    global SEED
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+"); ap.add_argument("--seed", type=int, default=201000)
    a = ap.parse_args()
    SEED = a.seed
    with Pool(8) as pool:
        out = pool.map(one, a.files)
    for p, s0, s1 in sorted(out, key=lambda r: r[1]):
        print(f"{os.path.basename(os.path.dirname(p)) if p.endswith('main.py') else os.path.basename(p):55s} s0 {s0[:90]}  s1 {s1[:120]}")


if __name__ == "__main__":
    main()
