# Study Guide: Git Integration and Programmatic Access

> This guide explains how the workspace interacts with Git programmatically — reading repository state for session capture, detecting commits for the knowledge graph, and showing git status in the editor. Git integration touches Phase 2 (session state), Phase 4 (editor git gutter), and Phase 5 (knowledge graph GitEvent entities).

---

## 1. Why Git Matters to the Workspace

Git is a rich source of context signals:

| Signal | Where It's Used |
|--------|----------------|
| Current branch name | Session state payload, status bar display |
| Uncommitted changes count | Session state, editor file status indicators |
| Recent commit messages | Knowledge graph (GitEvent entities), session context |
| File diff (what changed) | Session state `recent_file_edits`, editor git gutter |
| Ahead/behind remote | Session state, status bar |
| Blame information | Future: "who wrote this" in editor hover |

The workspace reads git data passively — it never modifies the repository (no commits, no pushes, no branch switching).

---

## 2. Two Ways to Access Git Programmatically

### Option 1: Shell Out to `git` CLI

The simplest approach — run `git` commands and parse the output:

```python
import subprocess

def git_status(repo_path: str) -> dict:
    result = subprocess.run(
        ["git", "status", "--porcelain", "-b"],
        cwd=repo_path,
        capture_output=True,
        text=True,
        timeout=5
    )
    if result.returncode != 0:
        return {"error": result.stderr}

    lines = result.stdout.strip().split("\n")
    branch_line = lines[0]  # "## main...origin/main [ahead 2]"
    changes = [line for line in lines[1:] if line]

    return {
        "branch": parse_branch(branch_line),
        "ahead_behind": parse_ahead_behind(branch_line),
        "changes": [parse_change(line) for line in changes],
    }
```

**Porcelain format** (`--porcelain`) gives machine-parseable output, unlike the human-readable default:

```
## main...origin/main [ahead 2]
 M src/train.py          ← modified, unstaged
M  src/config.yaml       ← modified, staged
?? new_file.py           ← untracked
A  src/utils.py          ← new file, staged
```

Status codes: `M` = modified, `A` = added, `D` = deleted, `R` = renamed, `??` = untracked. First column is staging area status, second column is working tree status.

**Pros:** Works everywhere git is installed. No library dependencies. Familiar commands.
**Cons:** Spawning a subprocess for every query has overhead (~10-50ms per call). Parsing text output is fragile.

### Option 2: Git Library (libgit2)

Use a library that accesses git's internal data structures directly:

**Rust: `git2` crate** (bindings to libgit2):
```rust
use git2::Repository;

fn get_repo_status(path: &str) -> Result<RepoStatus, git2::Error> {
    let repo = Repository::open(path)?;
    let head = repo.head()?;
    let branch = head.shorthand().unwrap_or("detached");

    let statuses = repo.statuses(None)?;
    let modified_count = statuses.iter()
        .filter(|s| s.status().is_wt_modified())
        .count();

    Ok(RepoStatus { branch: branch.to_string(), modified_count })
}
```

**Python: `pygit2`** (also bindings to libgit2):
```python
import pygit2

def get_repo_status(path: str) -> dict:
    repo = pygit2.Repository(path)
    branch = repo.head.shorthand
    status = repo.status()

    return {
        "branch": branch,
        "changes": [
            {"path": filepath, "status": flags}
            for filepath, flags in status.items()
        ]
    }
```

**Pros:** Much faster than shelling out (no subprocess overhead). Richer API (diff, blame, history traversal). Type-safe.
**Cons:** Additional dependency. libgit2 doesn't support every git feature (some edge cases differ from the `git` CLI).

### Recommendation

For this project, use a **hybrid approach**:
- **Rust `git2` crate** for frequently called operations (status, branch, diff stats) — these are called on every session capture (every 5 minutes) and for editor git gutter
- **Shell out to `git` CLI** for infrequent or complex operations (log, blame, remote status) — easier to implement and test

---

## 3. Git Data for Session State

The session capture process (Phase 2) gathers git signals:

```python
async def capture_git_context(repo_paths: list[str]) -> dict:
    """Gather git context from all watched repositories."""
    contexts = {}

    for repo_path in repo_paths:
        git_ctx = {}

        # Current branch
        branch = await run_git(repo_path, ["branch", "--show-current"])
        git_ctx["branch"] = branch.strip()

        # Uncommitted changes
        status = await run_git(repo_path, ["status", "--porcelain"])
        changes = [line for line in status.split("\n") if line.strip()]
        git_ctx["uncommitted_changes"] = len(changes)
        git_ctx["files_changed"] = [parse_filename(line) for line in changes[:10]]

        # Ahead/behind remote
        remote_status = await run_git(repo_path, [
            "rev-list", "--left-right", "--count", "HEAD...@{upstream}"
        ])
        if remote_status:
            ahead, behind = remote_status.strip().split("\t")
            git_ctx["ahead"] = int(ahead)
            git_ctx["behind"] = int(behind)

        # Recent commits (last 5)
        log = await run_git(repo_path, [
            "log", "--oneline", "-5", "--format=%H|%s|%an|%ai"
        ])
        git_ctx["recent_commits"] = [
            parse_commit_line(line) for line in log.strip().split("\n") if line
        ]

        contexts[repo_path] = git_ctx

    return contexts
```

This context is included in the session state payload, so the LLM knows:
- "You're on branch `feature/multi-head-attention`"
- "You have 3 uncommitted changes in `train.py`, `config.yaml`, and `attention.py`"
- "Your branch is 2 commits ahead of main"

---

## 4. Git Gutter in the Editor (Phase 4)

The **git gutter** shows inline markers in the editor for lines that have been added, modified, or deleted compared to the last commit:

```
  1 │   import torch                    ← unchanged
  2 │   import torch.nn as nn           ← unchanged
  3 │ + import torch.optim as optim     ← ADDED (green marker)
  4 │
  5 │   class Trainer:
  6 │ ~ def __init__(self, lr=0.001):   ← MODIFIED (yellow marker)
  7 │ ~     self.lr = lr                ← MODIFIED
  8 │       self.model = None
```

### How It Works

1. **Get the file's content at HEAD:**
```rust
let repo = Repository::open(project_path)?;
let head = repo.head()?.peel_to_tree()?;
let blob = head.get_path(Path::new("src/train.py"))?.to_object(&repo)?;
let old_content = blob.as_blob().unwrap().content();
```

2. **Diff against the current file content:**
```rust
use similar::{TextDiff, ChangeTag};

let diff = TextDiff::from_lines(
    std::str::from_utf8(old_content)?,
    &current_content
);

let mut line_changes = Vec::new();
for change in diff.iter_all_changes() {
    match change.tag() {
        ChangeTag::Insert => line_changes.push(LineChange::Added(change.new_index())),
        ChangeTag::Delete => line_changes.push(LineChange::Deleted(change.old_index())),
        ChangeTag::Equal => {},
    }
}
```

3. **Send to frontend as CodeMirror line decorations:**
```typescript
// CodeMirror extension that adds gutter markers
const gitGutter = gutterLineClass.compute([gitChangesField], state => {
    const changes = state.field(gitChangesField);
    const markers = new RangeSetBuilder<GutterMarker>();

    for (const change of changes) {
        const line = state.doc.line(change.lineNumber);
        markers.add(line.from, line.from,
            change.type === 'added' ? addedMarker :
            change.type === 'modified' ? modifiedMarker :
            deletedMarker
        );
    }
    return markers.finish();
});
```

### Performance Consideration

Diffing is recomputed when the file content changes (on each save, or on each keystroke if you want real-time gutter updates). For a typical file (< 1,000 lines), diffing takes < 1ms. For very large files, debounce the diff computation to avoid blocking the editor.

---

## 5. GitEvent Entities (Phase 5)

The knowledge graph treats git events as entities:

```python
async def create_git_event_entity(commit: GitCommit, profile_id: str):
    """Create a GitEvent entity from a git commit."""
    entity = Entity(
        id=generate_uuid(),
        entity_type="GitEvent",
        title=commit.message_summary,  # First line of commit message
        content=commit.full_message,
        metadata=json.dumps({
            "event_type": "commit",
            "commit_hash": commit.hash,
            "author": commit.author,
            "timestamp": commit.timestamp.isoformat(),
            "files_changed": commit.changed_files,
            "insertions": commit.insertions,
            "deletions": commit.deletions,
        }),
        source_file=None,
        workspace_profile_id=profile_id,
    )

    db.insert_entity(entity)

    # Auto-link to modified files
    for filepath in commit.changed_files:
        code_units = db.query_entities(source_file=filepath, entity_type="CodeUnit")
        for unit in code_units:
            db.create_link(
                source=entity.id,
                target=unit.id,
                relationship="modified",
                confidence=1.0,
                auto_generated=True,
            )
```

### Detecting New Commits

Two approaches:

**Polling:** Periodically run `git log --since={last_check}` to find new commits:
```python
async def check_for_new_commits(repo_path: str, since: datetime):
    log = await run_git(repo_path, [
        "log", f"--since={since.isoformat()}", "--format=%H|%s|%an|%ai|--stat"
    ])
    return parse_git_log(log)
```

**Git hooks:** Install a `post-commit` hook that notifies the application:
```bash
#!/bin/sh
# .git/hooks/post-commit
curl -s -X POST http://127.0.0.1:9400/api/v1/ingest \
    -H "Content-Type: application/json" \
    -d "{\"source_type\": \"git_commit\", \"content\": \"$(git log -1 --format='%H|%s')\"}"
```

Polling is simpler and works without modifying the repository. Git hooks are faster (instant notification) but require installation.

---

## 6. Handling Multiple Repositories

A workspace profile might watch multiple directories, each potentially a separate git repository:

```yaml
# Workspace profile: thesis-research
watched_directories:
  - /home/user/thesis       # git repo: thesis
  - /home/user/experiments  # git repo: ml-experiments
  - /home/user/shared-utils # git repo: team-utilities
```

The system detects git repositories by checking for `.git` directories:

```python
def find_git_repos(directories: list[str]) -> list[str]:
    """Find all git repositories in the watched directories."""
    repos = set()
    for dir_path in directories:
        for root, dirs, files in os.walk(dir_path):
            if '.git' in dirs:
                repos.add(root)
                dirs.remove('.git')  # Don't recurse into .git
    return list(repos)
```

Each repository is tracked independently: separate branch, separate commit history, separate git gutter data.

---

## 7. Git and the `.contextignore` File

The context engine respects `.gitignore` to avoid indexing files that git ignores. But it also has its own `.contextignore` for files that git *tracks* but shouldn't be *indexed*:

```
# .contextignore
# Large data files (tracked by git-lfs, but don't embed them)
data/**/*.csv
data/**/*.parquet

# Generated files (tracked, but regenerated from source)
generated/**
docs/api/**

# Vendored dependencies
vendor/**
```

Git's ignore mechanism uses the same glob syntax, so the parsing logic is shared.

---

## Key Takeaways

1. **Git is read-only in this project.** The workspace reads repository state but never modifies it. No automated commits, no branch management.

2. **Use `git2` (Rust) for frequent operations.** Status, branch, and diff are called often. Avoid subprocess overhead.

3. **Porcelain format for CLI parsing.** `--porcelain` gives stable, machine-readable output. Never parse git's default human-readable output.

4. **Git gutter uses line-level diffing.** Compare the file's HEAD version against the current content. Send line change markers to CodeMirror as gutter decorations.

5. **Commits become knowledge graph entities.** Each commit links to the code files it modified, creating `modified` relationships that trace code evolution.

6. **Multiple repositories per workspace.** Detect `.git` directories in watched paths. Track each independently.

---

## Further Reading

- [git2 Crate (Rust)](https://docs.rs/git2/latest/git2/) — Rust bindings for libgit2
- [pygit2 Documentation](https://www.pygit2.org/) — Python bindings for libgit2
- [Git Porcelain Format](https://git-scm.com/docs/git-status#_short_format) — Machine-readable status output
- [Git Hooks](https://git-scm.com/docs/githooks) — Server and client-side hooks
- [similar Crate (Rust)](https://docs.rs/similar/latest/similar/) — Text diffing library for Rust
