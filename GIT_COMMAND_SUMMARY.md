# Git Command Summary — Staging, Committing, Reverting

A quick reference for the three core moves of everyday Git work.

## 1. Check where you are

```bash
git status          # what is changed, staged, untracked
git status --short  # condensed one-line-per-file view
```

## 2. Staging (`git add`)

Staging moves changes into the **index** (the "staging area") — a draft of the next commit.

```bash
git add src/main.tsx        # stage one file
git add src/ docs/          # stage a folder
git add -p src/App.tsx      # interactively choose individual hunks
git add -u                  # stage edits/deletions to tracked files only
```

Undo staging (unstage) while keeping the file edits:

```bash
git restore --staged src/main.tsx   # modern syntax (Git 2.23+)
git reset HEAD src/main.tsx         # older equivalent
```

Deleting a tracked file and staging that deletion in one step:

```bash
git rm src/main.tsx         # remove from disk AND stage the deletion
```

## 3. Committing (`git commit`)

```bash
git commit -m "day-10: delete src/main.tsx file"   # commit what is staged
git commit                                          # open editor for a longer message
git commit --amend                                  # rewrite the most recent commit
```

Only staged changes are recorded — that is the whole point of the staging area.

## 4. Reverting / discarding changes

### Discard unstaged edits in the working tree

```bash
git restore src/main.tsx      # modern syntax
git checkout -- src/main.tsx  # classic syntax
```

### Unstage a file (keep the edits)

```bash
git restore --staged src/main.tsx
```

### Bring a deleted file back from a specific commit

```bash
git log --oneline -- src/main.tsx        # find the commit that still had it
git restore --source=<short-hash> src/main.tsx
# or the classic form:
git checkout <short-hash> -- src/main.tsx
```

### Revert a commit on an already-shared branch

`git revert` creates a **new** commit that undoes an earlier one, so history is never rewritten:

```bash
git revert <hash>             # safe for shared/public branches
git reset --hard <hash>       # rewrites history — local-only branches
```

## Rule of thumb

| Goal | Command |
| --- | --- |
| Discard local edit | `git restore <file>` |
| Unstage only | `git restore --staged <file>` |
| Recover a deleted file | `git restore --source=<hash> <file>` |
| Undo a shared commit | `git revert <hash>` |
| Undo a local commit | `git reset --hard <hash>` |
