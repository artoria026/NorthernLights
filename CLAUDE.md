# Instrucciones para agentes en este repo

## Branches y commits

Antes de crear una branch nueva, seguir [docs/CONVENTIONS.md](docs/CONVENTIONS.md):

1. Preguntar qué tipo de branch corresponde (`feature`, `bugfix`, `hotfix`, `chore`,
   `refactor`, `docs`, `test`, `release`) si el usuario no lo dijo explícitamente.
2. Si el usuario solo da una descripción del trabajo, proponer el tipo que mejor
   encaje y confirmarlo antes de crear la branch -- no asumirlo en silencio.
3. Nombrar la branch como `<tipo>/<descripcion-kebab-case>` y los commits como
   `<tipo>(<scope opcional>): <descripción en imperativo>`, según el detalle y los
   ejemplos reales de [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
4. Nombre de branch y mensajes de commit **siempre en inglés**, aunque la conversación
   sea en español; los commits deben ser breves (una línea).
5. Antes de dar una branch por lista para PR/merge, hacer rebase contra `master` y
   squashear todos sus commits en uno solo -- ver sección 3 de
   [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

## Documentación del proyecto

- [README.md](README.md) -- stack, setup, arquitectura, mapa de funcionalidades.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) -- nomenclatura de branches y commits.
- [docs/RELEASING.md](docs/RELEASING.md) -- checklist para liberar una versión y
  redactar el changelog.
- [docs/legal/DISCLAIMER.md](docs/legal/DISCLAIMER.md) -- aviso de privacidad (copia
  legible; el texto real que se muestra en la app vive en
  `frontend-web/src/lib/disclaimer.ts`).
- [docs/DISCLAIMER_INPUTS.md](docs/DISCLAIMER_INPUTS.md) -- inventario de
  features/datos usado como insumo para el disclaimer.
