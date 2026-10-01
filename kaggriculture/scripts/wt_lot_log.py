"""How does the wheat tick trade do against the real ladder rivals? Replays a candidate (v11.6-style layer) in our seat of
fetched ladder games against the rival's recorded actions and reads the layer's own state every turn: lots placed, clean
lots and what each cleared for (till after the sale turn minus till before the buy turn), and when the stop fired.

  python wt_lot_log.py CAND.py DIR [DIR ...] [--workers 28] [--out results/wt_lots.jsonl]
"""
import argparse, contextlib, io, json, pathlib, sys
from multiprocessing import Pool

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arena import _load  # noqa: E402
from diff_replay import tape_agent  # noqa: E402

OURS = ("clove instalocker", "lost")


def play(job):
    cand, path = job
    from kaggle_environments import make
    rep = json.load(open(path))
    names = rep["info"]["TeamNames"]
    if not any(n in OURS for n in names) or all(n in OURS for n in names):
        return None
    me = next(i for i, n in enumerate(names) if n in OURS)
    steps = rep["steps"]
    tape = [steps[t + 1][1 - me].get("action") or {} for t in range(len(steps) - 1)]
    log = dict(lots=[], off_step=None)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        inner = _load(cand)
        g = inner.__globals__

        def agent(obs, cfg=None):
            act = inner(obs, cfg)
            try:
                st = g["_WT_STATE"].get(int(obs["player"]), {})
                step = int(obs["step"]); cash = float(obs["farms"][int(obs["player"])]["money"])
                lot = st.get("lot")
                if lot and lot["step"] == step:                       # a lot was placed this turn
                    log["lots"].append(dict(step=step, qty=lot["qty"], clean=bool(lot["clean"]), cash0=lot["cash"]))
                if log["lots"]:
                    last = log["lots"][-1]
                    if last["step"] == step - 2 and lot and lot.get("sold_step") == step - 1:
                        last["sold_clean"] = bool(lot.get("sold_clean")); last["cash2"] = cash
                if st.get("off") and log["off_step"] is None:
                    log["off_step"] = step
            except Exception:
                pass
            return act

        agents = [None, None]
        agents[me], agents[1 - me] = agent, tape_agent(tape)
        env = make("kaggriculture", configuration={"seed": rep["info"]["seed"], "episodeSteps": 720, "actTimeout": 30}, debug=False)
        final = env.run(agents)[-1]
    r = [final[0].reward, final[1].reward]
    clean = [l["cash2"] - l["cash0"] for l in log["lots"] if l["clean"] and l.get("sold_clean") and "cash2" in l]
    return dict(ep=path.stem, opp=names[1 - me], real=rep["rewards"][me] - rep["rewards"][1 - me], cf=(r[me] or 0) - (r[1 - me] or 0),
                lots=len(log["lots"]), units=sum(l["qty"] for l in log["lots"]), off_step=log["off_step"],
                clean_n=len(clean), clean_sum=sum(clean), clean_min=min(clean) if clean else None,
                clean_list=[int(x) for x in clean][:60], tel={k: v for k, v in dict(getattr(inner, "telemetry", {}) or {}).items() if k.startswith("wt_")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cand"); ap.add_argument("dirs", nargs="+")
    ap.add_argument("--workers", type=int, default=28); ap.add_argument("--out", default="results/wt_lots.jsonl")
    a = ap.parse_args()
    jobs = [(a.cand, p) for d in a.dirs for p in sorted(pathlib.Path(d).glob("*.json"))]
    with Pool(a.workers, maxtasksperchild=4) as pool, open(a.out, "w") as f:
        for r in pool.imap_unordered(play, jobs):
            if r:
                f.write(json.dumps(r) + "\n"); f.flush()
    rows = [json.loads(l) for l in open(a.out)]
    off = [r for r in rows if r["off_step"] is not None]
    print(f"{len(rows)} games; won {sum(r['cf'] > 0 for r in rows)}; stop fired in {len(off)} ({sum(r['cf'] > 0 for r in off)} won)")
    print(f"clean lots {sum(r['clean_n'] for r in rows)}, mean result {sum(r['clean_sum'] for r in rows) / max(1, sum(r['clean_n'] for r in rows)):+.1f}")
    for r in sorted(off, key=lambda r: r["off_step"]):
        print(f"  off at step {r['off_step']:3d} (day {r['off_step'] // 24}) lots {r['lots']:3d} cf {int(r['cf']):7d} real {int(r['real']):7d} {r['opp'][:18].encode('ascii', 'replace').decode():18s} clean {r['clean_list'][-6:]}")


if __name__ == "__main__":
    main()
