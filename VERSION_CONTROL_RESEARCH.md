# Version Control — Research Notes

## What is version control?

A system that records every change to a set of files over time, so you can:

- Recall any previous state of the project ("time travel").
- See **who** changed **what**, **when**, and ideally **why**.
- Work on features in parallel without overwriting each other.

A **repository** holds the full history. Each **commit** is an immutable snapshot plus a message and a pointer to its parent commit, forming a chain (the history).

## Why it is mandatory for teams

1. **Safety net** — a mistake is a `git restore` away, not a lost afternoon.
2. **Parallel work** — branches let several people change the same codebase at once.
3. **Audit and accountability** — `git blame` / `git log` show the origin of every line.
4. **Code review** — changes arrive as reviewable diffs, not as files emailed around.
5. **Merging instead of overwriting** — the tooling merges independent lines of work.
6. **Rollback** — a bad release can be reverted in one command.
7. **Onboarding** — history explains how the codebase got its current shape.

Without it, teams fall back on `final_v2_really_final.zip`, and nobody knows which copy is authoritative.

## Git vs. GitHub

| | Git | GitHub |
| --- | --- | --- |
| What it is | A distributed version control **system** (software) | A hosted **platform** built on top of Git |
| Where it runs | Locally, on your machine | In the cloud, at github.com |
| Requires the other? | No — Git works standalone (even offline) | No — GitLab, Bitbucket, Azure DevOps are alternatives |
| Core job | Tracking commits, branches, merges | Hosting remotes, pull requests, issues, CI, code review |
| Typical command | `git commit`, `git branch`, `git merge` | `git push` to a remote, then open a Pull Request |

In one sentence: **Git is the tool that tracks the history; GitHub is a website that hosts Git repositories and adds collaboration features.**

## What is a merge conflict?

When two branches change the **same part of the same file** in different ways, Git cannot decide which version is correct. It pauses the merge and marks the file as conflicted.

Conflict markers look like this:

```text
<<<<<<< HEAD
const port = 3001;          // your branch
=======
const port = 4000;          // incoming branch
>>>>>>> day-9-feature
```

Resolution steps:

```bash
git status                        # list conflicted files
# edit the file, keep the correct content, delete the <<<<<<< ======= >>>>>>> markers
git add <resolved-file>           # mark it resolved
git commit                        # complete the merge
```

Preventing conflicts: pull/sync often, keep branches short-lived, and keep commits small and focused on one concern.

Conflicts are **normal**, not a sign of failure — they are Git asking a human to make a judgement call it cannot make for you.
