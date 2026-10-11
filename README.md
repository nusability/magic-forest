# Magic Forest

A mobile game for the App Store and Google Play. A magic, colorful bird, seen from behind,
flies through the air trailing sparkles. Wherever they land, a magic forest grows branch by
branch, leaf by leaf, into glowing blossoms. Each level asks you to grow the forest to a target
size, and you keep choosing whether to detour for amplifiers and multipliers.

- **Stage**: prototype (`web/`, three.js + TypeScript + Vite, see ADR 0003)
- **Play it**: GitHub Pages, built from `web/` on every push to `main`
- **Run it locally**: `cd web && npm ci && npm run dev`
- **Spec**: [`specs/spec.md`](specs/spec.md) · **Rules**: [`AGENTS.md`](AGENTS.md) · **Work**: Stori `MFOR`

Built from `game-template`: sketch in `web/` until it's fun, then `/graduate` to build the
native apps.

## How it differs from stock Spec Kit

| Stock Spec Kit | Here |
|---|---|
| One spec per feature (`specs/NNN-feature/`) | **One spec** for the whole game, `specs/spec.md`, as it is *now*. Features are `F-NNN` sections. |
| `tasks.md` in the repo | Tasks live on the change's **Stori** work item (`/speckit-tasks` writes them there). |
| `research.md` | **ADRs** in `decisions/`. One-way doors go through `/architecture` (the `mobile-architect` subagent). |
| Versioned constitution | No versions on the spec, plan or constitution. **Git is the version.** |
| Feature branches | **Trunk-based**: spec + code commit together to `main`. |
| — | **`Stage:`** in the spec header: `prototype → pre-prod → live`, which switches rules on. |
| — | **Platform-delta table**: iOS and Android agree, or the difference is written down and dated. |
| — | **Golden vectors**: deterministic simulation pinned by `shared/vectors/`, replayed by both apps. |

## What's in here

```text
AGENTS.md                     operating rules (CLAUDE.md imports it)
conventions.md                stack standards (Swift, Kotlin, the web prototype)
.specify/memory/constitution.md   values + trade-off sliders + stages
.specify/templates/           spec / plan / checklist templates (single-spec)
.specify/scripts/bash/        Spec Kit scripts (ensure-spec.sh replaces create-new-feature.sh)
.claude/skills/               speckit-*, architecture, new-game, graduate
.claude/agents/               mobile-architect (consulted on one-way doors)
decisions/                    ADRs (0001 two native codebases, 0002 web is the prototype)
specs/                        spec.md, plan.md, data-model.md (created by the skills)
web/  ios/  android/          the three surfaces
shared/{data,assets,vectors}/ what the platforms share; none of it is code
```

## Maintaining the template

Changes to Spec Kit to re-apply after `specify init --force` or a Spec Kit upgrade:

- `.specify/scripts/bash/common.sh`: `get_feature_paths` always resolves to `specs/` (unless
  `SPECIFY_FEATURE_DIRECTORY` is set).
- `.specify/scripts/bash/ensure-spec.sh` replaces `create-new-feature.sh`. `setup-tasks.sh`
  and `tasks-template.md` are removed (tasks live on Stori). `constitution-template.md` is
  removed (the constitution is concrete and amended in place).
- `.specify/templates/{spec,plan}-template.md` are specific to games and to single-spec mode.
- `.claude/skills/speckit-{specify,plan,tasks,implement,analyze,converge,constitution}` are
  rewritten. `speckit-clarify` and `speckit-checklist` have small patches.
  `speckit-taskstoissues` is removed.
