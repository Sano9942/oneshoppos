# Boris Cherny — Claude Code Creator's Complete Workflow & Tips

## Who is Boris Cherny?

- **Current role**: Software Engineer at Anthropic, creator & lead of Claude Code
- **Joined Anthropic**: September 2024 as a founding engineer — prototyped Claude Code as a side project
- **Previous**: Nearly 7 years at Meta (2017–2024), rising from IC4 to **Principal Engineer (IC8)**, leading teams of ~30 engineers on Instagram infra
- **Education**: Economics at UC San Diego (no CS degree — dropped out to pursue startups, started his first at 18)
- **Author**: *Programming TypeScript* (O'Reilly, 2019)
- **Output**: Claims ~100 PRs/week using his own workflow

---

## The Complete Boris Cherny Claude Code System (72+ tips across 9 threads)

All sourced from his X/Threads posts (Jan–Mar 2026) and compiled at https://howborisusesclaudecode.com/

---

### 1. Parallel Execution (the #1 tip)

> *"The single biggest productivity unlock"*

- Runs **5 terminal sessions** simultaneously (numbered tabs 1–5 with OS notifications)
- Plus **5–10 web sessions** on claude.ai/code
- Plus **mobile sessions** started in the morning and checked later
- Each session gets its own **git worktree** (`claude --worktree` or `claude -w`) so edits don't collide
- Uses `--teleport` or `&` to hand off sessions between terminal/web/phone
- Some team members use shell aliases (`za`, `zb`, `zc`) to hop between worktrees in one keystroke

### 2. Plan Mode First, Always

- **Shift+Tab twice** to enter plan mode
- Iterates back and forth on the plan until satisfied
- Then switches to **auto-accept edits mode** — Claude usually **1-shots** the implementation
- *"Pour your energy into the plan so Claude can 1-shot it"*
- When things go sideways mid-implementation, **re-enter plan mode** rather than patching

### 3. Model Choice: Opus with Thinking

- Uses **Opus 4.5 with extended thinking** for *every* task
- His reasoning: *"Even though it's bigger & slower than Sonnet, since you have to steer it less and it's better at tool use, it is almost always faster overall"*
- Sets effort to **High** (or `/effort max` for unlimited reasoning tokens)

### 4. CLAUDE.md as Living Documentation

- His CLAUDE.md is ~**100 lines** — concise, ruthlessly edited
- **Checked into git**, shared by the whole team, updated multiple times per week
- Golden rule: *"Anytime we see Claude do something incorrectly, we add it to CLAUDE.md so it doesn't repeat next time"*
- After corrections, ends with: *"Update your CLAUDE.md so you don't make that mistake again"*
- Uses **@.claude** in GitHub PR reviews to add learnings directly via a GitHub Action
- Over time, the mistake rate **measurably drops**

### 5. Slash Commands & Skills

- Creates **slash commands** for every "inner loop" workflow done many times/day
- Stored in `.claude/commands/` and checked into git
- Key example: `/commit-push-pr` — uses inline bash to pre-compute git status so it runs fast
- Team example: `/techdebt` — run at end of every session to find and kill duplicated code
- Also builds **custom skills** for reusable higher-level workflows

### 6. Subagents

- Append *"use subagents"* to any request where you want more compute thrown at the problem
- Keeps the **main agent's context window clean** by offloading tasks
- Subagents now support **worktree isolation** — can launch 10+ parallel agents for batched changes
- Custom agents: drop `.md` files in `.claude/agents/` with custom name, tools, permissions, model

### 7. Verification (2-3x quality multiplier)

> *"Give Claude a way to close the feedback loop"*

- **Chrome extension** for browser/frontend testing — iterate until output looks right
- Desktop app can auto-start web servers and test them with built-in browser
- Test suites, phone simulators, bash command verification
- Verification **2-3x's the quality** of the final result

### 8. Hooks for Automation

- **PostToolUse hooks**: auto-format code after generation (catches CI failures)
- **SessionStart hooks**: dynamically load context
- **PreToolUse hooks**: log bash commands
- **PermissionRequest hooks**: route approvals to external services
- **Stop hooks**: prompt continuation when agent halts prematurely
- **PostCompact hooks**: inject critical instructions after context compression

### 9. Permissions — Pre-Allow, Don't Skip

- Uses `/permissions` to pre-allow common safe commands with **wildcard syntax** (e.g., `"Bash(bun run *)"`)
- Checks permissions into team `settings.json`
- Prefers this over `--skip-permissions` for safety
- **Auto mode**: built-in classifiers auto-approve safe operations, flag risky ones

### 10. Tool Integrations

- **Slack MCP**: paste bug threads, say "fix" — Claude finds the code and fixes it
- **BigQuery CLI**: hasn't written SQL by hand in 6+ months
- **Sentry error logs**: Claude reads errors and proposes fixes autonomously
- **Multi-repo**: `--add-dir /path` gives Claude access across multiple repos

### 11. Prompting Discipline

- *"Challenge Claude to do better"* — don't accept mediocre first attempts
- Write **detailed specs** upfront
- Request **elegant solutions** after getting a working-but-rough fix
- Have one Claude draft plans while another reviews them "as a staff engineer"

---

## Advanced Features Reference

| Feature | What it does |
|---------|-------------|
| `/batch` | Fan out migrations to dozens/thousands of agents in parallel worktrees, each creates a PR |
| `/loop` | Schedule recurring tasks (up to 3 days) — PR babysitting, Slack summaries, deploy monitoring |
| `/schedule` | Cloud-based recurring jobs that survive laptop closure |
| `/btw` | Ask quick questions mid-task without interrupting the agent |
| `/branch` | Fork your session into a branched conversation |
| `/simplify` | Runs parallel agents to improve code quality + CLAUDE.md compliance |
| `/color` | Visually distinguish parallel sessions |
| `--bare` | 10x faster SDK startup by skipping config discovery |
| `--name` | Name sessions for identification in parallel execution |
| `--teleport` | Move sessions across mobile/web/desktop/terminal |
| `--add-dir` | Give Claude access to multiple repositories |
| `--agent` | Launch custom agent (`claude --agent=<name>`) |
| `/effort max` | Unlimited reasoning tokens for deeper thinking |
| `/voice` | Dictate instead of type (hold spacebar in CLI) |

---

## Part-by-Part Breakdown (all 9 threads)

### Part 1: Parallel Execution & Sessions (13 tips)

1. Run 5 Claude instances in parallel using separate git checkouts, numbered 1–5 with OS notifications
2. Manage 5–10 additional sessions on claude.ai/code, use `&` or `--teleport` to switch
3. Use Opus 4.5 with thinking for every task
4. Maintain shared CLAUDE.md checked into git, updated multiple times weekly
5. Use @.claude in code reviews to add learnings to CLAUDE.md via GitHub Action
6. Start sessions in Plan Mode (shift+tab twice), iterate, then auto-accept
7. Create slash commands for inner-loop workflows in `.claude/commands/`
8. Design subagents as automations (code-simplifier, verify-app, build-validator)
9. Use PostToolUse hooks to auto-format code after generation
10. Pre-allow safe permissions via `/permissions` instead of skip-permissions
11. Integrate Slack MCP, BigQuery CLI, and Sentry for autonomous tool use
12. Handle long-running tasks with background agents, Stop hooks, or `--permission-mode=dontAsk`
13. Provide Claude verification feedback loops — browser testing yields 2–3x quality improvement

### Part 2: Advanced Workflows (10 tips)

1. Spin up 3–5 git worktrees simultaneously (preferred over checkouts by the team)
2. Start every complex task in Plan Mode — re-plan when things go sideways
3. Invest in CLAUDE.md — end corrections with "Update CLAUDE.md"; ruthlessly edit over time
4. Create your own skills for tasks done multiple times daily; commit to git
5. Claude fixes most bugs by itself — enable Slack MCP, paste bug threads, say "fix"
6. Level up prompting — challenge Claude, write detailed specs, request elegant solutions
7. Terminal setup — use Ghostty, customize status bar with `/statusline`, enable voice dictation
8. Use subagents — append "use subagents" to requests; offload to keep main context clean
9. Use Claude for data & analytics — query databases via CLI tools (BigQuery)
10. Learning with Claude — enable "Explanatory" output style; generate HTML presentations; ASCII diagrams

### Part 3: Customization (12 tips)

1. Configure terminal — `/config` for themes, `/terminal-setup` for shift+enter, `/vim` for vim mode
2. Adjust effort level — `/model` to pick Low/Medium/High; Boris uses High for everything
3. Install plugins, MCPs, and skills — `/plugin` to browse official marketplace
4. Create custom agents — drop `.md` files in `.claude/agents/`
5. Pre-approve common permissions with wildcard syntax, check into team settings.json
6. Enable sandboxing — `/sandbox` for file and network isolation
7. Add a status line — `/statusline` for model, directory, context remaining, cost
8. Customize keybindings — `/keybindings` to remap any key (live-reload)
9. Set up hooks — lifecycle hooks for permission routing, auto-continue, pre/post-process
10. Customize spinner verbs — e.g., Star Trek themed; check into source control
11. Use output styles — `/config` to set Explanatory, Learning, or Custom tone
12. Customize all the things — settings.json supports 37 settings and 84 environment variables

### Part 4: Worktrees & Isolation (5 tips)

1. `claude --worktree my_worktree` or `--tmux` for isolated sessions
2. Worktree checkbox in Claude Desktop app Code tab
3. Subagents support worktree isolation — launch 10+ parallel agents for batched changes
4. Custom agents support `isolation: worktree` in frontmatter for always-isolated execution
5. WorktreeCreate/WorktreeRemove hooks for Mercurial, Perforce, SVN (non-git)

### Part 5: Shipping & Automation (2 tips)

1. `/simplify` — runs parallel agents to improve code quality, efficiency, and CLAUDE.md compliance
2. `/batch` — interactively plan code migrations, execute with dozens of agents in parallel worktrees

### Part 6: Recurring Tasks & Code Review (3 tips)

1. `/loop` — schedule recurring tasks up to 3 days; handles PR babysitting, Slack summaries, deploy monitoring
2. Code review — dispatches team of specialized agents on every PR, posts inline comments
3. `/btw` — ask quick questions mid-task; single-turn with no tool calls but full context

### Part 7: End-of-Week Features (8 tips)

1. `/effort max` — unlimited reasoning tokens for deeper thinking
2. Remote control sessions — `claude remote-control` spawns local sessions from mobile (Max/Team/Enterprise)
3. Voice mode — microphone in Desktop/Cowork, hold spacebar in CLI
4. Setup scripts — bash script in cloud environment settings, runs before session launch
5. `claude --name` — name sessions for identification in parallel execution
6. Auto session naming — Claude names session after plan mode based on task content
7. `/color` — change prompt color to distinguish parallel sessions visually
8. PostCompact hook — fires after context compression; inject critical instructions

### Part 8: New Superpowers (4 tips)

1. Auto mode — safer than skip-permissions; classifiers auto-approve safe ops, flag risky ones
2. `/schedule` — cloud-based recurring jobs that survive laptop closure (unlike `/loop`)
3. iMessage plugin — text Claude from Apple devices (`/plugin install imessage@claude-plugins-official`)
4. Auto-memory & auto-dream — automatic memory saving; auto-dream consolidates memory periodically

### Part 9: Hidden & Underutilized Features (15 tips)

1. Mobile app — iOS/Android, tap Code tab for full session from phone
2. Teleport between devices — `/teleport` or `--teleport` across mobile/web/desktop/terminal
3. `/loop` and `/schedule` — schedule workflows for up to week-long execution
4. Hooks — SessionStart, PreToolUse, PermissionRequest, Stop lifecycle hooks
5. Cowork dispatch — remote control for Desktop app; manage Slack, files, tasks remotely
6. Chrome extension — browser testing for frontend work; iterate until perfect
7. Desktop app — auto-starts and tests web servers with built-in browser
8. Fork session — `/branch` or `claude --resume <id> --fork-session`
9. `/btw` — ask questions mid-work without stopping agent
10. Git worktrees — `claude -w` for parallel work; WorktreeCreate hook for non-git VCS
11. `/batch` — fan out migrations to dozens/thousands of agents; each creates PR independently
12. `--bare` — 10x faster SDK startup by skipping config discovery
13. `--add-dir` — give Claude access to multiple repositories
14. `--agent` — launch custom agent; set default agent in settings.json
15. `/voice` — dictate instead of type; hold spacebar in CLI

---

## The Philosophy in One Sentence

> Plan carefully, run many sessions in parallel with worktree isolation, invest in your CLAUDE.md as a living error log, give Claude verification tools, and challenge it to do better.

---

## Team Culture Notes

- The whole Claude Code team contributes to a **shared CLAUDE.md**
- *"There is no one correct way to use Claude Code — we intentionally build it so you can customize and hack it however you like. Each person on the team uses it very differently."*
- Team prefers worktrees over separate checkouts (which is why they built native support)

---

## Sources

- [How Boris Uses Claude Code (official 72-tip compilation)](https://howborisusesclaudecode.com/)
- [Boris Cherny on X — original setup thread](https://x.com/bcherny/status/2007179832300581177)
- [Boris Cherny on X — team tips thread](https://x.com/bcherny/status/2017742741636321619)
- [Boris Cherny on Threads — setup](https://www.threads.com/@boris_cherny/post/DTBVlMIkpcm/)
- [Boris Cherny on Threads — team tips](https://www.threads.com/@boris_cherny/post/DUMZr4VElyb/)
- [Boris Cherny on Threads — worktrees](https://www.threads.com/@boris_cherny/post/DVAAnexgRUj/)
- [Team tips gist](https://gist.github.com/joyrexus/e20ead11b3df4de46ab32b4a7269abe0)
- [shanraisshan/claude-code-best-practice (GitHub)](https://github.com/shanraisshan/claude-code-best-practice)
- [Boris Cherny career profile — Developing Dev](https://www.developing.dev/p/boris-cherny-creator-of-claude-code)
- [Building Claude Code — Pragmatic Engineer (Gergely Orosz)](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
- [InfoQ — Inside the Development Workflow](https://www.infoq.com/news/2026/01/claude-code-creator-workflow/)
- [VentureBeat coverage](https://venturebeat.com/technology/the-creator-of-claude-code-just-revealed-his-workflow-and-developers-are)
- [Medium — Boris's tips as a skill](https://alirezarezvani.medium.com/boris-chernys-claude-code-tips-are-now-a-skill-here-is-what-the-complete-collection-reveals-b410a942636b)
- [XDA Developers — Setup guide](https://www.xda-developers.com/set-up-claude-code-like-boris-cherny/)
