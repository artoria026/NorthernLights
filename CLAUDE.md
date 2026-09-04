# Instructions for agents in this repo

## Branches and commits

Before creating a new branch, follow [docs/CONVENTIONS.md](docs/CONVENTIONS.md):

1. Ask which branch type applies (`feature`, `bugfix`, `hotfix`, `chore`,
   `refactor`, `docs`, `test`, `release`) if the user hasn't said so explicitly.
2. If the user only gives a description of the work, propose the type that best
   fits and confirm it before creating the branch -- don't assume it silently.
3. Name the branch as `<type>/<description-kebab-case>` and commits as
   `<type>(<optional scope>): <description in imperative mood>`, per the detail and
   real examples in [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
4. Branch name and commit messages **always in English**, even if the conversation
   is in Spanish; commits must be short (one line).
5. Before considering a branch ready for PR/merge, rebase against `master` and
   squash all its commits into one -- see section 3 of
   [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Project documentation

- [README.md](README.md) -- stack, setup, architecture, feature map.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) -- branch and commit naming conventions.
- [docs/RELEASING.md](docs/RELEASING.md) -- checklist for releasing a version and
  writing the changelog.
- [docs/legal/DISCLAIMER.md](docs/legal/DISCLAIMER.md) -- privacy notice (readable
  copy, kept in Spanish on purpose -- it must match the real text shown in the app,
  which lives in `frontend-web/src/lib/disclaimer.ts`).
- [docs/DISCLAIMER_INPUTS.md](docs/DISCLAIMER_INPUTS.md) -- inventory of
  features/data used as input for the disclaimer.
