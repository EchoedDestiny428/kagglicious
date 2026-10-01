"""Counterfactual ladder games: our candidate (live) vs the opponent's recorded actions.

  python replay_cf.py CAND.py [CAND2.py ...] [--dir ladder_replays] [--team lost] [--workers 10] [--all]
  python replay_cf.py CAND.py [...] --dir clone_replays --seats clone_replays/seats.jsonl
      (games we are not in: the candidate takes the seat opposite the clone listed in seats.jsonl)

For every lost game (or every fetched game with --all) the candidate takes our seat and plays the
same seed against the opponent's recorded action tape. The opponent does not react to the candidate,
so this is an approximation, but it tests against the real rivals that beat us.
"""
import argparse, contextlib, io, json, pathlib, sys
from multiprocessing import Pool

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arena import _load  # noqa: E402
from diff_replay import tape_agent  # noqa: E402


# Our Kaggle team was renamed "lost" -> "clove instalocker" on ~2026-09-21; replay sets span the rename.
OUR_TEAMS = ("clove instalocker", "lost")

ORACLE = False
ORACLE_DIR = None      # with --oracle-dir: predicted rival actions per episode (json list) instead of the true tape


def play(job):
    cand, path, team, oracle, oracle_dir, seat = job
    global ORACLE
    ORACLE = oracle
    from kaggle_environments import make
    rep = json.load(open(path))
    names = rep["info"]["TeamNames"]
    if seat is None:
        me = next((i for i, n in enumerate(names) if n == team), None)
        if me is None:
            me = next(i for i, n in enumerate(names) if n in OUR_TEAMS)
    else:
        me = seat
    steps = rep["steps"]
    tape = [steps[t + 1][1 - me].get("action") or {} for t in range(len(steps) - 1)]
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        agent = _load(cand)
        if ORACLE and "_ORACLE" in agent.__globals__:
            agent.__globals__["_ORACLE"] = tape       # oracle test: the rival's recorded actions
            if oracle_dir:
                pf = pathlib.Path(oracle_dir) / f"{path.stem}.json"
                agent.__globals__["_ORACLE"] = json.load(open(pf)) if pf.exists() else None
        agents = [None, None]
        agents[me], agents[1 - me] = agent, tape_agent(tape)
        env = make("kaggriculture", configuration={"seed": rep["info"]["seed"], "episodeSteps": 720, "actTimeout": 30}, debug=False)
        final = env.run(agents)[-1]
    r = [final[0].reward, final[1].reward]
    return dict(cand=cand, ep=path.stem, opp=names[1 - me], seat=me, real=rep["rewards"][me] - rep["rewards"][1 - me],
                cf=(r[me] or 0) - (r[1 - me] or 0), status=[final[0].status, final[1].status])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cands", nargs="+")
    ap.add_argument("--dir", default="ladder_replays")
    ap.add_argument("--team", default="clove instalocker")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--oracle", action="store_true", help="give candidates with an _ORACLE global the rival's tape")
    ap.add_argument("--oracle-dir", default=None, help="use predicted rival actions from this folder instead")
    ap.add_argument("--seats", default=None, help="seats.jsonl from fetch_clones.py: play the seat opposite the clone")
    args = ap.parse_args()
    global ORACLE
    ORACLE = args.oracle
    folder = pathlib.Path(args.dir)
    seat_of = {}
    if args.seats:
        for l in pathlib.Path(args.seats).read_text().splitlines():
            r = json.loads(l)
            seat_of[str(r["episode"])] = 1 - int(r["clone_seat"])
        paths = [folder / f"{e}.json" for e in seat_of]
    else:
        rows = [json.loads(l) for l in (folder / "results.jsonl").read_text().splitlines()]
        paths = [folder / f"{r['episode']}.json" for r in rows if (args.all or r["result"] == "L")]
    paths = [p for p in paths if p.exists()]
    jobs = [(c, p, args.team, args.oracle, args.oracle_dir, seat_of.get(p.stem)) for c in args.cands for p in paths]
    with Pool(args.workers, maxtasksperchild=1) as pool:
        out = pool.map(play, jobs)
    for c in args.cands:
        mine = [r for r in out if r["cand"] == c]
        wins = sum(r["cf"] > 0 for r in mine)
        print(f"{pathlib.Path(c).name:28s} games {len(mine):3d}  wins {wins:3d}  mean margin {sum(r['cf'] for r in mine) / max(1, len(mine)):+8.0f}"
              f"  (real mean {sum(r['real'] for r in mine) / max(1, len(mine)):+8.0f})")
    print()
    for p in paths:
        cells = [f"{next(r['cf'] for r in out if r['cand'] == c and r['ep'] == p.stem):+7.0f}" for c in args.cands]
        real = next(r for r in out if r["ep"] == p.stem)
        print(f"{p.stem} {real['opp'][:16]:16s} real {real['real']:+7.0f} | " + " ".join(cells))


if __name__ == "__main__":
    main()
