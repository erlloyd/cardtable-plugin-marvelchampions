# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Project workflow conventions

### bd: always use the `--actor` flag, never `BEADS_ACTOR=` env prefix

When attributing bd commands to a specific actor (e.g. `agent-heroes`, `eric-main`), use the `--actor <name>` global flag — not the `BEADS_ACTOR=<name> bd ...` env-prefix form.

```bash
# Good
bd update mc-1u7 --claim --actor agent-heroes
bd update mc-1u7 --status closed --actor agent-heroes --notes "summary"

# Bad — silently falls through to default actor in this project's sandbox
BEADS_ACTOR=agent-heroes bd update mc-1u7 --claim
```

Reason: spawned agents in this project's sandbox can't run env-prefixed commands; they get permission-denied without a prompt and silently use the default actor (git user.name), weakening the audit trail.

Also note: `bd close <id>` is not in this project's allowlist. Use `bd update <id> --status closed --notes "<reason>" --actor <name>` instead.

### Plugin file validator

Run `node scripts/validate-plugin.mjs` (no args = validates all `marvelchampions-*.json` in repo root, or pass file paths to validate specific ones) after writing or modifying any asset pack or scenario file. The validator checks face-filename conventions, cardType resolution against `marvelchampions-base.json`, cardSet card existence, and scenario pack/cardSet/card references. Exit 0 = clean, exit 1 = errors.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
