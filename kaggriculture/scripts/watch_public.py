"""Watch for new public kaggriculture notebooks (the field copies them within days).

  python watch_public.py [--state public_seen.json] [--pages 2]

Lists the competition's kernels by date, prints any ref not seen before, and remembers them. Run it daily;
a new V-series notebook from the V46/V50 author usually means the ladder clones will follow.
"""
import argparse, json, pathlib, subprocess

KAGGLE = "kaggle"   # the Kaggle CLI on PATH


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="public_seen.json")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--kaggle", default=KAGGLE)
    a = ap.parse_args()
    seen = json.loads(pathlib.Path(a.state).read_text()) if pathlib.Path(a.state).exists() else {}
    fresh = []
    for page in range(1, a.pages + 1):
        out = subprocess.run([a.kaggle, "kernels", "list", "--competition", "kaggriculture", "--sort-by", "dateRun",
                              "--page-size", "50", "--page", str(page), "--csv"], capture_output=True, text=True).stdout
        for line in out.splitlines()[1:]:
            ref = line.split(",")[0].strip()
            if not ref or ref == "ref":
                continue
            if ref not in seen:
                seen[ref] = line
                fresh.append(line)
    pathlib.Path(a.state).write_text(json.dumps(seen, indent=0))
    print(f"{len(seen)} notebooks known, {len(fresh)} new")
    for line in fresh:
        print("  NEW", line[:160])


if __name__ == "__main__":
    main()
