"""Download recent ladder replays of one submission and list the games it lost.

  python fetch_losses.py SUBMISSION_ID [--last N] [--dir ladder_replays] [--team lost]

Replays are kept in DIR/<episode>.json (~32 MB each; wins too, so replay_cf.py can check that a
change does not flip wins). Prints one line per game: episode, seat, rewards, opponent team.
"""
import argparse, json, pathlib, subprocess

KAGGLE = "kaggle"   # the Kaggle CLI on PATH


def episodes(sub_id):
    out = subprocess.run([KAGGLE, "competitions", "episodes", str(sub_id), "--format", "json"],
                         capture_output=True, text=True, check=True).stdout
    rows, _ = json.JSONDecoder().raw_decode(out.strip())   # the CLI prints a trailer after the JSON
    return [e for e in rows if "COMPLETED" in e["state"]]


def fetch(ep_id, folder):
    path = folder / f"{ep_id}.json"
    if not path.exists():
        subprocess.run([KAGGLE, "competitions", "replay", str(ep_id), "-p", str(folder), "-q"],
                       capture_output=True, text=True, check=True)
        # the CLI names the file after the episode; normalize whatever it wrote
        for p in folder.glob(f"*{ep_id}*"):
            if p != path:
                p.rename(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sub_id")
    ap.add_argument("--last", type=int, default=30)
    ap.add_argument("--dir", default="ladder_replays")
    ap.add_argument("--team", default="clove instalocker")
    args = ap.parse_args()
    folder = pathlib.Path(args.dir)
    folder.mkdir(exist_ok=True)
    seen = folder / "results.jsonl"
    done = {json.loads(l)["episode"] for l in seen.read_text().splitlines()} if seen.exists() else set()
    for e in episodes(args.sub_id)[:args.last]:
        if e["id"] in done:
            if not (folder / f"{e['id']}.json").exists():
                fetch(e["id"], folder)   # re-download a replay deleted by an older version
            continue
        try:
            path = fetch(e["id"], folder)
            rep = json.loads(path.read_text())
        except Exception as ex:
            print(e["id"], "fetch failed:", ex)
            continue
        names = rep.get("info", {}).get("TeamNames", ["?", "?"])
        rewards = rep.get("rewards") or [s.get("reward") for s in rep["steps"][-1]]
        seat = names.index(args.team) if args.team in names else -1
        opp = names[1 - seat] if seat >= 0 else "?"
        mine, theirs = (rewards[seat], rewards[1 - seat]) if seat >= 0 else (None, None)
        result = "?" if seat < 0 or mine is None or theirs is None else ("W" if mine > theirs else "L" if mine < theirs else "T")
        row = dict(episode=e["id"], seat=seat, rewards=rewards, opponent=opp, result=result)
        with seen.open("a") as f:
            f.write(json.dumps(row) + "\n")
        print(row)


if __name__ == "__main__":
    main()
