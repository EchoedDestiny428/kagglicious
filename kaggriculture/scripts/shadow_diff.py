"""Shadow-run our agent on another team's recorded games: feed it that team's own observations step by step (as if
we sat in its seat) and log every step where our action differs from the one the team actually played.

  python shadow_diff.py CAND.py DIR [--seats DIR/seats.jsonl] [--team DECEM] [--workers 8] [--out results/shadow.jsonl]

For a team on our own base (same tapes, same layers) the differences are its rule changes. After the first
difference the states drift from what our agent would have produced, so later differences are indicative only;
the report therefore lists first divergences per game and the per-day mix of differing market orders and unit
commands.
"""
import argparse, contextlib, io, json, pathlib, sys
from collections import Counter, defaultdict
from multiprocessing import Pool

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arena import _load  # noqa: E402

MOVES = ("NORTH", "SOUTH", "EAST", "WEST")


def norm_market(m):
    return [list(o) for o in (m or []) if o]


def units(a):
    return [list(a.get("farmer") or ["PASS"])] + [list(h or ["PASS"]) for h in (a.get("hands") or [])]


def play(job):
    cand, path, seat = job
    from kaggle_environments.utils import structify
    rep = json.load(open(path))
    st = rep["steps"]
    cfg = structify(rep["configuration"])
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        agent = _load(cand)
    diffs = []
    for t in range(len(st) - 1):
        obs = dict(st[t][seat]["observation"])
        obs["step"] = st[t][0]["observation"].get("step", t)
        obs["player"] = seat
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                ours = agent(structify(obs), cfg) or {}
        except Exception as e:
            diffs.append(dict(t=t, err=repr(e)[:120]))
            continue
        theirs = st[t + 1][seat].get("action") or {}
        mo, mt = norm_market(ours.get("market")), norm_market(theirs.get("market"))
        uo, ut = units(ours), units(theirs)
        n = max(len(uo), len(ut))
        uo += [["PASS"]] * (n - len(uo)); ut += [["PASS"]] * (n - len(ut))
        ud = [(i, uo[i], ut[i]) for i in range(n) if uo[i] != ut[i]]
        if mo != mt or ud:
            diffs.append(dict(t=t, mo=mo if mo != mt else None, mt=mt if mo != mt else None, ud=ud[:6]))
    names = rep["info"]["TeamNames"]
    return dict(ep=path.stem, seat=seat, opp=names[1 - seat], rewards=rep["rewards"], diffs=diffs)


def report(rows):
    firsts = []
    mkt_only_ours, mkt_only_theirs = Counter(), Counter()
    unit_pairs = Counter()
    per_day = Counter()
    for r in rows:
        d = r["diffs"]
        f = d[0] if d else None
        firsts.append((f["t"] if f else 999, r["ep"], f))
        seen_first_market = False
        for x in d:
            per_day[x["t"] // 24] += 1
            if x.get("mo") is not None or x.get("mt") is not None:
                so = Counter(json.dumps(o[:2]) for o in x.get("mo") or [])
                sm = Counter(json.dumps(o[:2]) for o in x.get("mt") or [])
                for k in so - sm:
                    mkt_only_ours[(x["t"] // 24, k)] += 1
                for k in sm - so:
                    mkt_only_theirs[(x["t"] // 24, k)] += 1
            for i, a, b in x.get("ud") or []:
                ka = a[0] if a[0] not in MOVES else "MOVE"
                kb = b[0] if b[0] not in MOVES else "MOVE"
                if ka != kb:
                    unit_pairs[(ka, kb)] += 1
    firsts.sort(key=lambda v: v[0])
    print("first divergence per game (step, day h, what):")
    for t, ep, f in firsts:
        if f is None:
            print(f"  {ep}: identical all game"); continue
        what = f"market ours {f.get('mo')} theirs {f.get('mt')}" if f.get("mo") is not None or f.get("mt") is not None else ""
        if f.get("ud"):
            what += f" units {f['ud'][:3]}"
        if f.get("err"):
            what = "ERROR " + f["err"]
        print(f"  {ep}: step {t:3d} (d{t // 24} h{t % 24:2d}) {what[:260]}")
    print("\ndiffering steps per day:", dict(sorted(per_day.items())))
    print("\nmarket orders only DECEM places (day, [op, item]) - top 25:")
    for (dday, k), v in sorted(mkt_only_theirs.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  d{dday:2d} {k:32s} {v}")
    print("\nmarket orders only we place (day, [op, item]) - top 25:")
    for (dday, k), v in sorted(mkt_only_ours.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  d{dday:2d} {k:32s} {v}")
    print("\nunit command swaps (ours -> theirs) - top 20:")
    for (a, b), v in unit_pairs.most_common(20):
        print(f"  {a:18s} -> {b:18s} {v}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cand"); ap.add_argument("dir")
    ap.add_argument("--seats", default=None)
    ap.add_argument("--team", default="DECEM")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="results/shadow.jsonl")
    ap.add_argument("--report-only", action="store_true")
    a = ap.parse_args()
    if not a.report_only:
        seats = {}
        sp = pathlib.Path(a.seats or pathlib.Path(a.dir) / "seats.jsonl")
        for l in sp.read_text().splitlines():
            r = json.loads(l)
            if r.get("clone_team", r.get("team", a.team)) == a.team:
                seats[str(r["episode"])] = int(r["clone_seat"] if "clone_seat" in r else r["seat"])
        jobs = [(a.cand, pathlib.Path(a.dir) / f"{e}.json", s) for e, s in seats.items() if (pathlib.Path(a.dir) / f"{e}.json").exists()]
        print(f"{len(jobs)} games of {a.team}", flush=True)
        with Pool(a.workers, maxtasksperchild=2) as pool, open(a.out, "w") as f:
            for r in pool.imap_unordered(play, jobs):
                f.write(json.dumps(r) + "\n"); f.flush()
    report([json.loads(l) for l in open(a.out)])


if __name__ == "__main__":
    main()
