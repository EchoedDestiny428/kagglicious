"""Overnight constant sweep of a base agent: every numeric/bool module-level constant, a few values each, through
an inert filter, a screen, a gate and a confirmation, all paired against the base on identical games.

  python csweep.py --base agents/crimson_v512.py --workers 28 [--resume]

Stages (results/csweep/*.jsonl, report in results/csweep/report.txt):
  0 inert   4 games/variant (pub_v56, seeds 221000-221001, both seats); identical rewards to the base -> dropped
  1 screen  new family x seeds 221000-221007 x 2 seats (96 games); paired net vs base >= +2 kept
  2 gate    new family x seeds 201000-201015 x 2 seats (192 games); net >= +3 kept
  3 confirm new family x seeds 231000-231023 (288 games) net >= +2 AND old panel x 201000-201015 (160 games) net >= 0
  4 combo   all stage-3 survivors appended together, confirmed on stage-3 games (net >= best single survivor)
Selection is by games won only (paired: wins where the base lost minus losses where the base won).
"""
import argparse, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
NEW = ["agents/pub_rescue.py", "agents/pub_v54.py", "agents/pub_v54fork.py", "agents/pub_v56.py",
       "agents/pub_busya.py", "agents/pub_shiiin9.py"]
OLD = ["agents/pub_2965.py", "agents/pub_meta13.py", "agents/pub_triad.py", "agents/pub_v51.py", "agents/pub_v46.py"]
SKIP = {"LAST_ACT_STEP", "MAX_ORDERS", "_RELEASE_ERRORS", "_ADV_TO", "_R37_PRICE_FLOOR", "_R37_HINGE_GAIN",
        "_33_SF_FROM", "_CA_MARGIN", "_ADV_LOOK", "APPLY_TIMING"}
OUT = os.path.join(HERE, "results", "csweep")  # overridden by --tag
VDIR = os.path.join(HERE, "agents", "csweep")


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(os.path.join(OUT, "report.txt"), "a") as f:
        f.write(line + "\n")


def constants(src):
    pat = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?|True|False)\s*(?:#.*)?$", re.M)
    last = {}
    for m in pat.finditer(src):
        last[m.group(1)] = m.group(2)
    return {k: v for k, v in last.items() if k not in SKIP}


def values(v):
    if v in ("True", "False"):
        return ["False" if v == "True" else "True"]
    if "." in v:
        x = float(v)
        cands = [0.5, 1.0] if x == 0 else [round(x * 0.7, 4), round(x * 1.3, 4)]
        return [repr(c) for c in cands if c != x]
    x = int(v)
    if abs(x) <= 4:
        cands = [x - 1, x + 1]
    else:
        cands = [int(round(x * 0.7)), int(round(x * 1.3))]
    return [str(c) for c in dict.fromkeys(cands) if c != x]


def make_variants(base):
    src = open(base, encoding="utf-8").read()
    os.makedirs(VDIR, exist_ok=True)
    out = {}
    for name, v in constants(src).items():
        for nv in values(v):
            label = f"{name}__{nv}".replace("-", "m").replace(".", "p")
            path = os.path.join(VDIR, label + ".py")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(src.rstrip("\n") + f"\n\n# ---------------------------------------------------------------- csweep: {name} {v} -> {nv}\n{name} = {nv}\n")
            out[label + ".py"] = (name, v, nv)
    return out


def run_arena(cands, opps, seeds, seed_base, out, workers):
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return
    cmd = ["nice", "-n", "19", PY, "-u", os.path.join(HERE, "arena.py"), "--cand", *cands, "--opps", *opps,
           "--seeds", str(seeds), "--seed-base", str(seed_base), "--workers", str(workers), "--out", out]
    with open(out + ".log", "w") as lf:
        subprocess.run(cmd, cwd=HERE, stdout=lf, stderr=subprocess.STDOUT, check=False)


def load(paths):
    rows = []
    for p in paths:
        if os.path.exists(p):
            rows += [json.loads(l) for l in open(p)]
    return rows


def outcomes(rows, names):
    """{name: {(opp, seed, seat): (win, ra, rb)}} for games of `names` against agents not in `names`."""
    res = {n: {} for n in names}
    for r in rows:
        for me, you, rm, ry in (("a", "b", "ra", "rb"), ("b", "a", "rb", "ra")):
            n, o = os.path.basename(r[me]), os.path.basename(r[you])
            if n in res and o not in res:
                res[n][(o, r["seed"], me)] = ((r[rm] or 0) > (r[ry] or 0), r[rm], r[ry])
    return res


def paired(res, cand, base):
    up = dn = n = 0
    for k, (w, _, _) in res[cand].items():
        b = res[base].get(k)
        if b is None:
            continue
        n += 1
        up += w and not b[0]
        dn += b[0] and not w
    return up - dn, up, dn, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="agents/crimson_v512.py")
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--tag", default="csweep")
    ap.add_argument("--s0-base", type=int, default=221000)
    ap.add_argument("--s0-seeds", type=int, default=2)
    ap.add_argument("--s0-opps", nargs="+", default=["agents/pub_v56.py"])
    ap.add_argument("--only", default=None, help="file listing variant labels to consider")
    a = ap.parse_args()
    global OUT
    OUT = os.path.join(HERE, "results", a.tag)
    os.makedirs(OUT, exist_ok=True)
    base = a.base
    bname = os.path.basename(base)
    variants = make_variants(base)
    if a.only:
        keep = {l.strip() for l in open(a.only) if l.strip()}
        variants = {k: v for k, v in variants.items() if k in keep}
    log(f"stage 0: {len(variants)} variants of {bname}")
    vpaths = [os.path.join("agents", "csweep", k) for k in sorted(variants)]
    f0 = os.path.join(OUT, "s0.jsonl")
    run_arena([base] + vpaths, a.s0_opps, a.s0_seeds, a.s0_base, f0, a.workers)
    res = outcomes(load([f0]), [bname] + list(variants))
    live = []
    for k in sorted(variants):
        same = all(res[k].get(g, (None, None, None))[1:] == res[bname][g][1:] for g in res[bname])
        if not same:
            live.append(k)
    log(f"stage 0 done: {len(live)} live, {len(variants) - len(live)} inert")
    with open(os.path.join(OUT, "live.txt"), "w") as f:
        f.write("\n".join(live))

    f1 = os.path.join(OUT, "s1.jsonl")
    run_arena([base] + [os.path.join("agents", "csweep", k) for k in live], NEW, 8, 221000, f1, a.workers)
    res = outcomes(load([f1]), [bname] + live)
    s1 = sorted(((paired(res, k, bname), k) for k in live), reverse=True)
    for (net, up, dn, n), k in s1[:25]:
        name, v, nv = variants[k]
        log(f"  screen {name} {v}->{nv}: net {net:+d} (+{up}/-{dn} of {n})")
    keep1 = [k for (net, *_), k in s1 if net >= 2]
    log(f"stage 1 done: {len(keep1)} kept (net >= +2 of 96)")

    f2 = os.path.join(OUT, "s2.jsonl")
    if keep1:
        run_arena([base] + [os.path.join("agents", "csweep", k) for k in keep1], NEW, 16, 201000, f2, a.workers)
    res = outcomes(load([f2]), [bname] + keep1)
    s2 = sorted(((paired(res, k, bname), k) for k in keep1), reverse=True)
    for (net, up, dn, n), k in s2:
        name, v, nv = variants[k]
        log(f"  gate {name} {v}->{nv}: net {net:+d} (+{up}/-{dn} of {n})")
    keep2 = [k for (net, *_), k in s2 if net >= 3]
    log(f"stage 2 done: {len(keep2)} kept (net >= +3 of 192)")

    f3a, f3b = os.path.join(OUT, "s3_fresh.jsonl"), os.path.join(OUT, "s3_old.jsonl")
    if keep2:
        run_arena([base] + [os.path.join("agents", "csweep", k) for k in keep2], NEW, 24, 231000, f3a, a.workers)
        run_arena([base] + [os.path.join("agents", "csweep", k) for k in keep2], OLD, 16, 201000, f3b, a.workers)
    ra, rb = outcomes(load([f3a]), [bname] + keep2), outcomes(load([f3b]), [bname] + keep2)
    keep3 = []
    for k in keep2:
        fa, fb = paired(ra, k, bname), paired(rb, k, bname)
        name, v, nv = variants[k]
        ok = fa[0] >= 2 and fb[0] >= 0
        log(f"  confirm {name} {v}->{nv}: fresh net {fa[0]:+d} (+{fa[1]}/-{fa[2]} of {fa[3]}), old net {fb[0]:+d} of {fb[3]} -> {'KEEP' if ok else 'drop'}")
        if ok:
            keep3.append(k)
    log(f"stage 3 done: {len(keep3)} confirmed")

    if len(keep3) >= 2:
        src = open(base, encoding="utf-8").read().rstrip("\n")
        by_name = {}
        for k in keep3:
            name, v, nv = variants[k]
            by_name.setdefault(name, (k, nv))
        combo = os.path.join(VDIR, "combo.py")
        with open(combo, "w", encoding="utf-8", newline="\n") as f:
            f.write(src + "\n\n# ---------------------------------------------------------------- csweep combo\n"
                    + "".join(f"{n} = {nv}\n" for n, (k, nv) in by_name.items()))
        f4a, f4b = os.path.join(OUT, "s4_fresh.jsonl"), os.path.join(OUT, "s4_old.jsonl")
        run_arena([base, "agents/csweep/combo.py"], NEW, 24, 231000, f4a, a.workers)
        run_arena([base, "agents/csweep/combo.py"], OLD, 16, 201000, f4b, a.workers)
        ca, cb = outcomes(load([f4a]), [bname, "combo.py"]), outcomes(load([f4b]), [bname, "combo.py"])
        fa, fb = paired(ca, "combo.py", bname), paired(cb, "combo.py", bname)
        log(f"stage 4 combo of {list(by_name)}: fresh net {fa[0]:+d} of {fa[3]}, old net {fb[0]:+d} of {fb[3]}")
    log("ALL DONE")


if __name__ == "__main__":
    main()
