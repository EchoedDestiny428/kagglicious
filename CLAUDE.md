# kagglicious

Public portfolio of Kaggle competitions and tools. Follow [CONVENTIONS.md](CONVENTIONS.md).

- This repo is public. Never commit hostnames, IPs, passwords, keys, tokens, `kaggle.json`,
  personal paths or anything machine-specific. Those go in untracked `config.local.*` files.
- Competition code is published here only after the competition's deadline. Before that, only
  results and findings. Work in progress belongs in the private kaggle-lab repo.
- Commit messages: `<slug or tool>: <what changed> (<result>)`.
- Each tool in `tools/<name>/` has its own `package.json`, `.gitignore` and README.
- Before committing, check the staged diff for anything machine-specific.
