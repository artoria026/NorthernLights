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

- [README.md](README.md) -- what the project is, stack, architecture, feature map.
- [docs/SETUP.md](docs/SETUP.md) -- step-by-step to run this locally (database,
  env vars, the one manual Postgres role, tests).
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) -- branch and commit naming conventions.
- [docs/RELEASING.md](docs/RELEASING.md) -- checklist for releasing a version and
  writing the changelog.
- [docs/legal/DISCLAIMER.md](docs/legal/DISCLAIMER.md) -- privacy notice (readable
  copy, kept in Spanish on purpose -- it must match the real text shown in the app,
  which lives in `frontend-web/src/lib/disclaimer.ts`).
- [docs/DISCLAIMER_INPUTS.md](docs/DISCLAIMER_INPUTS.md) -- inventory of
  features/data used as input for the disclaimer.

## Frontend: norma para toda pantalla

- **El scrollbar nunca cambia el ancho del contenido.** Todo contenedor que hace scroll vertical
  (`<main>`, listas y modales con `max-h` + `overflow-y-auto`) reserva el ancho de la barra
  siempre (`scrollbar-gutter: stable`). La regla es **global**, en `frontend-web/src/index.css`
  (selectores `main`, `.overflow-y-auto`, `.overflow-auto`, `.overflow-y-scroll`): al crear una
  pantalla, un modal o una lista con scroll, usa esas clases y no pongas nada más. Solo una
  lista flotante (select, combobox) puede optar por no reservar con `[scrollbar-gutter:auto]`.
  Si haces un contenedor que scrollea de otra forma (p. ej. `overflow: scroll` en CSS propio),
  agrégale `scrollbar-gutter: stable`.
- Verifícalo pasando de una pantalla corta (Cuentas) a una larga (Transacciones): ningún
  encabezado, tarjeta ni filtro debe cambiar de ancho ni moverse.
