# Commit Message Guidelines — Good vs. Bad

A commit message is documentation for the future reader: a teammate, a reviewer, or you in six months.

## What a good commit message looks like

```text
day-10: revert src/main.tsx from commit e63a719
```

```text
fix(auth): prevent refresh loop when token expires early

The refresh interceptor fired on the same 401 that triggered it,
so retries never settled. Guard with an in-flight flag.

Refs: #142
```

### Qualities of a good message

- **Imperative mood** — "add", "fix", "remove" (completes: *"This commit will…"*).
- **Specific** — names the file, feature, or module affected.
- **Explains why**, not just what, when the change is not obvious.
- **Short subject line** — aim for ~50 characters, hard cap ~72.
- **One logical change** per commit.

### Conventional prefixes that help scanning

| Prefix | Use for |
| --- | --- |
| `feat:` | a new feature |
| `fix:` | a bug fix |
| `docs:` | documentation only |
| `refactor:` | behaviour-neutral code change |
| `test:` | adding or fixing tests |
| `chore:` | tooling, config, dependencies |

## What makes a bad commit message

```text
update
```

```text
fixed stuff
```

```text
WIP
```

```text
changes to main.tsx and also css and also package.json and refactored the worker
```

| Anti-pattern | Why it hurts |
| --- | --- |
| `fix`, `update`, `wip` | Zero information; unusable in `git log` or `git blame` |
| Whole essay in the subject | Truncated in every log view; put detail in the body |
| Mixing unrelated changes | Cannot be reverted cleanly — reverting one fixes all |
| "Changed X" with no reason | Reviewer cannot judge whether the change is correct |
| Blaming/frustrated tone | Commits are permanent and public |

## Two-line rule for this repo

If someone can't tell *what* changed and *why* from the first line plus one body paragraph, the message is not finished.
