"""Local kaggriculture arena: seeded head-to-head matches in isolated processes.

Agents are loaded exactly like Kaggle loads main.py (kaggle_environments'
get_last_callable), fresh for every game, so module-level state never leaks.

  python arena.py --cand agents/x.py --opps agents/a.py agents/b.py --seeds 8 --workers 10 --out results/x.jsonl
  python arena.py --summary results/x.jsonl
"""
import argparse
import contextlib
import inspect
import io
import json
import multiprocessing as mp
import os
import sys
import time
import traceback
from collections import defaultdict

LOCAL_ACT_TIMEOUT = 30  # generous locally; real per-call times are recorded and checked separately


def _load(path):
    from kaggle_environments.agent import get_last_callable
    with open(path, encoding="utf-8") as f:
        src = f.read()
    return get_last_callable(src, path=os.path.abspath(path))


def _timed(fn, times):
    nparams = len(inspect.signature(fn).parameters)

    def wrapped(obs, config):
        t = time.perf_counter()
        out = fn(obs, config) if nparams >= 2 else fn(obs)
        times.append(time.perf_counter() - t)
        return out

    return wrapped


def play(task):
    a_path, b_path, seed = task
    ta, tb = [], []
    t0 = time.time()
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            from kaggle_environments import make
            A = _timed(_load(a_path), ta)
            B = _timed(_load(b_path), tb)
            env = make("kaggriculture", configuration={"seed": seed, "episodeSteps": 720, "actTimeout": LOCAL_ACT_TIMEOUT}, debug=False)
            final = env.run([A, B])[-1]
        ta_s, tb_s = sorted(ta), sorted(tb)
        return {
            "a": a_path, "b": b_path, "seed": seed,
            "ra": final[0].reward, "rb": final[1].reward,
            "sa": final[0].status, "sb": final[1].status,
            "secs": round(time.time() - t0, 1),
            "a_max_ms": round(1000 * ta_s[-1], 1) if ta_s else None,
            "b_max_ms": round(1000 * tb_s[-1], 1) if tb_s else None,
            "a_p99_ms": round(1000 * ta_s[int(0.99 * (len(ta_s) - 1))], 1) if ta_s else None,
            "b_p99_ms": round(1000 * tb_s[int(0.99 * (len(tb_s) - 1))], 1) if tb_s else None,
            "shops": list(env.steps[-1][0].observation.town["unlocked_shops"]),
        }
    except Exception:
        return {"a": a_path, "b": b_path, "seed": seed, "error": traceback.format_exc()[-2000:], "secs": round(time.time() - t0, 1)}


def summarize(paths, cand=None, yarn=None):
    rows = []
    for p in paths:
        with open(p) as f:
            rows.extend(json.loads(l) for l in f if l.strip())
    if yarn is not None:
        # "2" = exactly 2 YARN_STOREs in the final shop list, "2+" = at least 2
        lo = int(yarn.rstrip("+"))
        rows = [r for r in rows if "shops" in r and (r["shops"].count("YARN_STORE") >= lo if yarn.endswith("+")
                                                      else r["shops"].count("YARN_STORE") == lo)]
    errors = [r for r in rows if "error" in r]
    for r in errors[:3]:
        print("ERROR", r["a"], r["b"], r["seed"], r["error"][-400:])
    stats = defaultdict(lambda: {"w": 0, "l": 0, "t": 0, "margin": 0.0, "own": 0.0, "n": 0, "bad": 0, "max_ms": 0.0})
    for r in rows:
        if "error" in r:
            continue
        for me, opp, rm, ro, sm, mm in (("a", "b", r["ra"], r["rb"], r["sa"], r["a_max_ms"]), ("b", "a", r["rb"], r["ra"], r["sb"], r["b_max_ms"])):
            name, other = os.path.basename(r[me]), os.path.basename(r[opp])
            if cand and name != os.path.basename(cand):
                continue
            s = stats[(name, other)]
            s["n"] += 1
            rm, ro = rm or 0.0, ro or 0.0
            s["w" if rm > ro else "l" if rm < ro else "t"] += 1
            s["margin"] += rm - ro
            s["own"] += rm
            s["bad"] += sm != "DONE"
            s["max_ms"] = max(s["max_ms"], mm or 0.0)
    tot = defaultdict(lambda: [0, 0, 0, 0.0, 0.0, 0])
    print(f"{'agent':34s} {'vs':34s} {'W-L-T':>9s} {'win%':>6s} {'mean$':>9s} {'margin':>8s} {'maxms':>7s} bad")
    for (name, other), s in sorted(stats.items()):
        n = s["n"]
        print(f"{name:34s} {other:34s} {s['w']:3d}-{s['l']:2d}-{s['t']:2d} {100 * (s['w'] + 0.5 * s['t']) / n:6.1f} {s['own'] / n:9.0f} {s['margin'] / n:8.0f} {s['max_ms']:7.1f} {s['bad']}")
        t = tot[name]
        t[0] += s["w"]; t[1] += s["l"]; t[2] += s["t"]; t[3] += s["own"]; t[4] += s["margin"]; t[5] += n
    print("--- totals")
    for name, (w, l, t, own, margin, n) in sorted(tot.items(), key=lambda kv: -(kv[1][0] + 0.5 * kv[1][2]) / kv[1][5]):
        print(f"{name:34s} {w:4d}-{l:4d}-{t:3d} win% {100 * (w + 0.5 * t) / n:5.1f} mean$ {own / n:9.0f} margin {margin / n:8.0f} (n={n})")
    print(f"games={len(rows)} errors={len(errors)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cand", nargs="*", default=[])
    ap.add_argument("--opps", nargs="*", default=[])
    ap.add_argument("--round-robin", nargs="*", default=[])
    ap.add_argument("--seeds", type=int, default=4)
    ap.add_argument("--seed-base", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="results/run.jsonl")
    ap.add_argument("--summary", nargs="*")
    ap.add_argument("--only", default=None)
    ap.add_argument("--seed-list", default=None, help="file with one seed per line (overrides --seeds/--seed-base)")
    ap.add_argument("--yarn", default=None, help="summary filter: YARN_STORE count, e.g. 0, 1, 2+")
    args = ap.parse_args()
    if args.summary:
        summarize(args.summary, args.only, args.yarn)
        return
    if args.seed_list:
        with open(args.seed_list) as f:
            seeds = [int(l) for l in f if l.strip()]
    else:
        seeds = [args.seed_base + i for i in range(args.seeds)]
    tasks = []
    pairs = [(c, o) for c in args.cand for o in args.opps if c != o]
    rr = args.round_robin
    pairs += [(rr[i], rr[j]) for i in range(len(rr)) for j in range(i + 1, len(rr))]
    for c, o in pairs:
        for s in seeds:
            tasks.append((c, o, s))
            tasks.append((o, c, s))
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    print(f"{len(tasks)} games on {args.workers} workers -> {args.out}", flush=True)
    t0 = time.time()
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.workers, maxtasksperchild=1) as pool, open(args.out, "a") as out:
        for i, r in enumerate(pool.imap_unordered(play, tasks), 1):
            out.write(json.dumps(r) + "\n")
            out.flush()
            if i % max(1, len(tasks) // 20) == 0 or i == len(tasks):
                print(f"  {i}/{len(tasks)} done, {time.time() - t0:.0f}s", flush=True)
    summarize([args.out])


if __name__ == "__main__":
    main()
