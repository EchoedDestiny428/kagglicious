# Conventions

How Kaggle work is organised, committed and synced between computers.

## Two repositories

| Repo | Visibility | What goes in |
|---|---|---|
| **kaggle-lab** | private | Everything in progress: agents, notebooks, experiment scripts, worklogs, submitted files. |
| **kagglicious** (this repo) | public | Results and findings during a competition; code and tools only **after** its deadline. Tools that are not tied to a competition (`tools/`). |

Kaggle's rules forbid sharing competition code outside Kaggle while a competition runs, so code
moves from kaggle-lab to here only once the competition has ended.

## Layout of a competition (in kaggle-lab)

```
<slug>/                  e.g. kaggriculture
  README.md              link, deadline, metric, current best
  WORKLOG.md             dated entries, newest first
  src/                   the agent / model
  scripts/               arena, evaluation, analysis tools
  submissions/           exact copies of every file sent to Kaggle
    README.md            one row per submission
  data/                  inputs (Kaggle download)       not in git
  runs/                  outputs (replays, logs, weights) not in git
```

Start a new competition by copying `_template/` in kaggle-lab to `<slug>/`.

- **One name per file.** Working code keeps its name. Git history and tags are the versions, not
  `agent_v4.py`, `v5/` or `.bak_<date>` copies.
- **`submissions/` is the exception.** It keeps an exact copy of each submitted file, named
  `<agent>_v<major>.<minor>.py`. Its README has one row per submission: file, Kaggle submission id,
  date (UTC), what changed, SHA-256 (first 8 characters) and score once known.
- **WORKLOG.md** gets an entry whenever something is learned: the date, a one-line headline, and
  numbers (arena record, score, rank). Losing experiments go in too.

## When to commit

In kaggle-lab:

- **Something ran end to end**: an experiment, a new tool, a fix that works. Commit it, win or lose,
  with the result in the message.
- **Before a risky change.** This replaces making a `.bak` copy.
- **Every submission.** Commit the copy in `submissions/`, then tag it:
  `git tag <slug>/<agent>-v<version>` (for example `kaggriculture/crimson-v3.1`).
- **End of every session, and before switching computers**: run `sh sync.sh`. A `wip:` commit is
  fine here.

In kagglicious, commit only at milestones: a new best score, a finding worth writing up, or the code
release after a competition.

## Commit messages

```
<slug>: <what changed, in the imperative> (<result>)

Optional body: numbers, what was tried, what was learned.
```

- `kaggriculture: sale lookahead 16 -> 24 (arena 212-30 vs v3.1)`
- `kaggriculture: add v3.3 and v4 to ladder scores`
- `tessera: add settings popover`
- `wip: kaggriculture route search half done` (kaggle-lab only, from `sync.sh`)

The prefix is the competition slug, the tool name, or `repo` for changes to the repo itself.

## Syncing between computers

- **Code and notes** travel through git:
  - When you sit down, run `sh sync.sh`. It pulls what the other machine pushed.
  - When you leave, run `sh sync.sh "<message>"`. It commits everything, pulls, and pushes.
  - Never work on a second machine before syncing the first.
- **The remote server** runs `git pull` in its clone before starting runs.
- **Data** is not synced. On a new machine, install the Kaggle CLI and download it into the
  competition's `data/`:
  ```
  pip install kaggle
  kaggle competitions download -c <slug> -p <slug>/data
  ```
  (The CLI reads your API token from `~/.kaggle/kaggle.json`.)
- **Outputs** (`runs/`) stay where they were made. Copy one over with `scp` when you need it.

## Never commit

- Data, replays, model weights, or any file over 20 MB (`data/`, `runs/`).
- `kaggle.json`, `.env`, SSH keys, hostnames, IPs, or personal paths.
- `config.local.*`: every tool keeps machine-specific settings there, next to a committed
  `*.example` file with placeholders.

A pre-commit hook (`.githooks/pre-commit`) blocks the obvious cases. Turn it on once per clone:
`git config core.hooksPath .githooks` (kaggle-lab's `sync.sh` does this for you).

## Publishing a finished competition

After the deadline:

1. Copy the final agent, the tools worth showing, results and findings from `kaggle-lab/<slug>/` to
   `kagglicious/<slug>/`.
2. Remove server paths, hostnames and anything machine-specific.
3. Write the README like [kaggriculture/README.md](kaggriculture/README.md): the task, a results
   table, how the approach evolved, the tools built, and the findings.
4. Commit as `<slug>: publish code and tools`.
