"""Head-to-head constant sweep against the base itself: every single-constant variant of BASE (csweep.py's rules) plays
BASE on --seeds seeds in both seats. A variant identical to the base wins 50%; the mirror race is where our close ladder
losses are decided (54 of 90 lost by < $2k to v13-family mirrors), and unlike the public panel or the ladder tapes the
live mirror reacts to our sales.

  python h2h_sweep.py --base agents/crimson_v513.py --seeds 16 --seed-base 241000 --out results/h2h13_s1.jsonl
  python h2h_sweep.py ... --only results/h2h13_keep.txt --seeds 32 --seed-base 251000 --out results/h2h13_s2.jsonl
"""
import argparse, json, os, subprocess, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import csweep  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="agents/crimson_v513.py")
    ap.add_argument("--vdir", default="agents/csweep13")
    ap.add_argument("--seeds", type=int, default=16)
    ap.add_argument("--seed-base", type=int, default=241000)
    ap.add_argument("--workers", type=int, default=28)
    ap.add_argument("--only", default=None)
    ap.add_argument("--out", default="results/h2h13_s1.jsonl")
    a = ap.parse_args()
    csweep.VDIR = os.path.join(HERE, a.vdir)
    variants = csweep.make_variants(os.path.join(HERE, a.base))
    labels = sorted(variants)
    if a.only:
        keep = {l.strip() for l in open(a.only) if l.strip()}
        labels = [l for l in labels if l in keep]
    cands = [os.path.join(a.vdir, l) for l in labels]
    print(f"{len(cands)} variants x {a.seeds} seeds x 2 seats vs {a.base}", flush=True)
    if not (os.path.exists(a.out) and os.path.getsize(a.out) > 0):
        cmd = ["nice", "-n", "19", sys.executable, "-u", os.path.join(HERE, "arena.py"), "--cand", *cands,
               "--opps", a.base, "--seeds", str(a.seeds), "--seed-base", str(a.seed_base), "--workers", str(a.workers),
               "--out", a.out]
        with open(a.out + ".log", "w") as lf:
            subprocess.run(cmd, cwd=HERE, stdout=lf, stderr=subprocess.STDOUT, check=False)
    w, n, marg = Counter(), Counter(), Counter()
    for l in open(a.out):
        r = json.loads(l)
        for me, you, rm, ry in (("a", "b", "ra", "rb"), ("b", "a", "rb", "ra")):
            c = os.path.basename(r[me])
            if c in labels and os.path.basename(r[you]) == os.path.basename(a.base):
                n[c] += 1; w[c] += (r[rm] or 0) > (r[ry] or 0); marg[c] += (r[rm] or 0) - (r[ry] or 0)
    rows = sorted(labels, key=lambda c: (-w[c] / max(1, n[c]), -marg[c]))
    for c in rows[:30]:
        name, v, nv = variants[c]
        print(f"  {name} {v}->{nv}: {w[c]}/{n[c]} won ({100 * w[c] / max(1, n[c]):.0f}%), mean margin {marg[c] / max(1, n[c]):+.0f}")
    dist = Counter(w[c] for c in labels)
    print("wins histogram:", dict(sorted(dist.items())))


if __name__ == "__main__":
    main()
