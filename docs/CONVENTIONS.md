# Convenciones de branches y commits

Esta guía documenta cómo nombrar branches y commits en NorthernLights, a partir del
patrón que ya se viene usando en el repo (`git log`, `git branch -a`). El objetivo es
que sea consistente sin importar quién (o qué agente de IA) cree la branch o el commit.

## 1. Nomenclatura de branches

Formato: `<tipo>/<descripcion-corta-en-kebab-case>`

- `<descripcion-corta-en-kebab-case>` va en inglés, minúsculas, palabras separadas por
  guion medio, sin ticket/issue number a menos que ya exista uno (ej.
  `searchable-category-picker`, no `feature/45-searchable-category-picker`).
- Una branch se puede reutilizar para varios PRs si el trabajo es continuación directa
  del mismo tema (ya pasó con `feature/ctrl-enter-form-submit`, PRs #9, #10 y #11) --
  no es obligatorio abrir una branch nueva por cada PR si el alcance no cambió.

### Tipos

| Tipo | Cuándo usarlo | Ejemplo real/plausible |
|---|---|---|
| `feature/` | Funcionalidad nueva, mejora de UX/flujo existente | `feature/tdc-ux-polish`, `feature/expand-guided-tours` |
| `bugfix/` | Corrige un bug encontrado en desarrollo/staging, no en producción | `bugfix/category-picker-grouping` |
| `hotfix/` | Corrige un bug ya en producción, urgente, sale directo o casi directo a `master` | `hotfix/login-500-google-oauth` |
| `chore/` | Mantenimiento sin impacto de producto: dependencias, config, tooling, CI | `chore/bump-fastapi` |
| `refactor/` | Reestructura código interno sin cambiar comportamiento observable | `refactor/split-transaction-service` |
| `docs/` | Solo documentación (README, docs/, comentarios) | `docs/branching-conventions` |
| `test/` | Solo agrega/ajusta tests, sin tocar código de producto | `test/rls-enforcement-coverage` |
| `release/` | Prepara una liberación: bump de versión + changelog (ver [RELEASING.md](RELEASING.md)) | `release/v1.1.0` |

Si una descripción no encaja claramente en un tipo (ej. "mejora X e incidentalmente
arregla Y"), gana el tipo del cambio principal/más grande, no una mezcla.

## 2. Nomenclatura de commits (Conventional Commits)

Formato: `<tipo>(<scope opcional>): <descripción en imperativo, inglés, minúsculas>`

Ya es el patrón real usado en el historial del repo. Tipos vistos y su significado:

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva o cambio de comportamiento visible |
| `fix` | Corrección de bug |
| `chore` | Tarea de mantenimiento (deps, config, release) |
| `test` | Cambios solo en tests |
| `docs` | Cambios solo en documentación |
| `refactor` | Cambio interno sin alterar comportamiento |
| `style` | Formato/estilo puro (sin lógica) |
| `perf` | Mejora de rendimiento |
| `build` | Build system, empaquetado |
| `ci` | Pipelines/CI |
| `revert` | Revierte un commit anterior |

`scope` = módulo/área que toca el commit, en minúsculas, sin paréntesis anidados
(ejemplos ya usados: `ui`, `tours`, `transactions`, `mobile`, `auth`, `api`, `ai`,
`privacy`, `feedback`, `admin`, `accounts`, `release`). Es opcional -- se omite cuando
el cambio no es claramente de un solo módulo (ej. `feat: redesign category cards/icon
picker and standardize modal buttons`).

La descripción va en imperativo ("add", "fix", "move"), no en pasado ni gerundio
("added", "adding").

Los merge commits de PR (`Merge pull request #N from ...`) los genera GitHub al hacer
merge -- no hay que redactarlos a mano ni seguir esta convención para ellos.

**Idioma:** tanto el nombre de la branch (sección 1) como los mensajes de commit son
siempre en inglés, sin excepción -- aunque el resto de la conversación con el agente
sea en español.

## 3. Cerrar una branch: rebase + squash contra `master`

Cuando el trabajo de una branch ya está listo para entrega (PR o merge), antes de
abrir/actualizar el PR:

1. Traer `master` actualizado y rebasear la branch sobre él:
   `git fetch origin && git rebase origin/master`.
2. Squashear todos los commits de la branch en **uno solo** -- no importa cuántos
   commits intermedios haya habido durante el desarrollo (WIP, fixups, "address
   review comments", etc.), esos no deben sobrevivir al PR. Con `git rebase -i
   origin/master` (marcar todos menos el primero como `fixup`/`squash`), o con
   `git reset --soft $(git merge-base origin/master HEAD) && git commit`.
3. El mensaje del commit final sigue el formato de la sección 2 y debe ser **muy
   breve**: una sola línea, sin cuerpo ni bullet points salvo que el cambio sea grande
   y realmente lo amerite. Ejemplo: `feat(ui): polish TDC/MSI visuals and refresh debts
   page design` -- no una lista de todo lo que se tocó commit por commit.
4. Push de la branch reescrita con `git push --force-with-lease` (nunca `--force` a
   secas, y nunca contra `master`).

El resultado es que `master` queda con un commit por feature/fix (más el merge commit
de GitHub), no con el detalle de cada iteración de desarrollo.

## 4. Para agentes de IA (Claude Code y similares)

Antes de crear una branch nueva en este repo, el agente **debe**:

1. Preguntar explícitamente qué tipo de branch corresponde (`feature`, `bugfix`,
   `hotfix`, `chore`, `refactor`, `docs`, `test`, `release`) -- salvo que el usuario ya
   lo haya dicho explícitamente en su mensaje.
2. Si el usuario da una descripción del trabajo en vez de decir el tipo directamente,
   el agente puede **proponer** el tipo que mejor encaje según la tabla de la sección 1
   y confirmarlo con el usuario antes de crear la branch -- no asumirlo en silencio.
3. Generar el nombre de la branch en el formato `<tipo>/<descripcion-kebab-case>` de la
   sección 1, siempre en inglés, y los commits dentro de esa branch en el formato de
   la sección 2 (inglés, breves).

Antes de dar por lista una branch para entrega (PR o merge), el agente **debe** aplicar
el rebase + squash de la sección 3 -- nunca dejar que un PR se abra o actualice con el
historial de commits intermedios de desarrollo intacto, salvo que el usuario pida
explícitamente conservarlo.

Esto aplica tanto a branches creadas localmente como a cualquier PR que el agente abra.
