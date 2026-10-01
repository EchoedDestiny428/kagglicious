"""Constant sweep screened on real ladder games: the base and every variant take our seat in each fetched ladder
game and play its seed against the rival's recorded actions (replay_cf.play). Paired against the base by games won.

  python cf_sweep.py --base agents/crimson_v512.py --labels results/csweep/live.txt --dirs ladder_replays_v510 \
      --out results/cfs1.jsonl [--workers 28] [--report-only]

The public panel is saturated (v5.12 wins 96/96 of the csweep screen), so a variant can only show a gain against
opponents that still beat us; the ladder tapes are those opponents. Rows are appended as games finish, so a rerun
resumes. Mirror games between our own two submissions are skipped.
"""
import argparse, json, os, pathlib, sys
from multiprocessing import Pool

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import replay_cf  # noqa: E402

OURS = set(replay_cf.OUR_TEAMS)


def run(job):
    try:
        return replay_cf.play(job)
    except Exception as e:  # a crashed game counts as missing, not as a loss
        return dict(cand=job[0], ep=pathlib.Path(job[1]).stem, error=repr(e)[:200])


def games(dirs):
    out = []
    for d in dirs:
        rows = [json.loads(l) for l in (pathlib.Path(d) / "results.jsonl").read_text().splitlines() if l.strip()]
        for r in rows:
            p = pathlib.Path(d) / f"{r['episode']}.json"
            if p.exists() and r.get("opponent") not in OURS and r.get("result") in ("W", "L"):
                out.append(p)
    return out


def report(out, base, cands):
    res = {}
    for l in open(out):
        r = json.loads(l)
        if "cf" in r:
            res[(os.path.basename(r["cand"]), r["ep"])] = r["cf"] > 0
    b = os.path.basename(base)
    eps = {e for (c, e) in res if c == b}
    print(f"base {b}: {sum(res[(b, e)] for e in eps)}/{len(eps)} won")
    rows = []
    for c in cands:
        c = os.path.basename(c)
        if c == b:
            continue
        up = dn = n = 0
        for e in eps:
            if (c, e) not in res:
                continue
            n += 1
            up += res[(c, e)] and not res[(b, e)]
            dn += res[(b, e)] and not res[(c, e)]
        rows.append((up - dn, up, dn, n, c))
    for net, up, dn, n, c in sorted(rows, reverse=True):
        print(f"  {c:48s} net {net:+3d}  (+{up}/-{dn} of {n})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="agents/crimson_v512.py")
    ap.add_argument("--labels", default=None, help="file of variant labels in agents/csweep/")
    ap.add_argument("--cands", nargs="*", default=[], help="extra candidate paths")
    ap.add_argument("--dirs", nargs="+", default=["ladder_replays_v510"])
    ap.add_argument("--out", default="results/cfs1.jsonl")
    ap.add_argument("--team", default="clove instalocker")
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="only the first N ladder games (liveness check)")
    ap.add_argument("--episodes", default=None, help="file of episode ids to restrict to")
    ap.add_argument("--live-out", default=None, help="write labels whose margins differ from the base on some game")
    a = ap.parse_args()
    cands = [a.base] + list(a.cands)
    if a.labels:
        cands += [os.path.join("agents", "csweep", l.strip()) for l in open(a.labels) if l.strip()]
    if not a.report_only:
        done = set()
        if os.path.exists(a.out):
            for l in open(a.out):
                r = json.loads(l)
                if "cf" in r:
                    done.add((r["cand"], r["ep"]))
        paths = games(a.dirs)
        if a.episodes:
            keep = {l.split()[0] for l in open(a.episodes) if l.strip()}
            paths = [p for p in paths if p.stem in keep]
        if a.limit:
            paths = paths[:a.limit]
        jobs = [(c, p, a.team, False, None, None) for c in cands for p in paths if (c, p.stem) not in done]
        print(f"{len(paths)} ladder games, {len(cands)} candidates, {len(jobs)} games to play", flush=True)
        with Pool(a.workers, maxtasksperchild=4) as pool, open(a.out, "a") as f:
            for i, r in enumerate(pool.imap_unordered(run, jobs), 1):
                f.write(json.dumps(r) + "\n"); f.flush()
                if i % 200 == 0:
                    print(f"  {i}/{len(jobs)}", flush=True)
    report(a.out, a.base, cands)
    if a.live_out:
        cf = {}
        for l in open(a.out):
            r = json.loads(l)
            if "cf" in r:
                cf[(os.path.basename(r["cand"]), r["ep"])] = r["cf"]
        b = os.path.basename(a.base)
        live = [os.path.basename(c) for c in cands[1:]
                if any(cf.get((os.path.basename(c), e)) != v for (cc, e), v in cf.items() if cc == b)]
        open(a.live_out, "w").write("\n".join(live))
        print(f"{len(live)} of {len(cands) - 1} candidates live on these games -> {a.live_out}")


if __name__ == "__main__":
    main()
