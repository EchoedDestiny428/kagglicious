#!/usr/bin/env python3
"""Print one JSON line per job for Tessera's status strip.

Copy this to the remote machine and point jobs.command at it. It reports:
  * every tmux session, with the last line of output as the detail
  * every ~/.jobs/*.json file, for scripts that report their own progress:
      {"name": "train-v4", "state": "running", "detail": "epoch 12/40", "progress": 0.3}
"""
import glob
import json
import os
import subprocess


def tmux_jobs():
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    jobs = []
    for name in out.stdout.split():
        try:
            pane = subprocess.run(
                ["tmux", "capture-pane", "-p", "-t", name],
                capture_output=True, text=True, timeout=5,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            pane = ""
        lines = [l.strip() for l in pane.splitlines() if l.strip()]
        jobs.append({"name": name, "state": "running", "detail": lines[-1] if lines else ""})
    return jobs


def file_jobs():
    jobs = []
    for path in sorted(glob.glob(os.path.expanduser("~/.jobs/*.json"))):
        try:
            with open(path) as f:
                job = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(job, dict):
            job.setdefault("name", os.path.splitext(os.path.basename(path))[0])
            jobs.append(job)
    return jobs


if __name__ == "__main__":
    for job in tmux_jobs() + file_jobs():
        print(json.dumps(job))
