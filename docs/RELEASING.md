# Cómo liberar una versión y redactar su changelog

Esta guía es para cuando se va a hacer una liberación (release) de NorthernLights: qué número de
versión le toca, cómo sacar la lista de cambios de forma confiable (no de memoria), y cómo redactar
cada línea del changelog que ven los usuarios dentro de la app ("Novedades", el ícono de 📣 en el
sidebar).

No es una guía de cómo programar la feature — es la checklist de los pasos de **cierre** de una
liberación, una vez que el código ya está listo.

## 1. Dónde vive todo esto

- **Versión de la app:** `frontend-web/package.json`, campo `"version"`. Es la que se ve como
  "NorthernLights vX.X.X" al pie del sidebar (`AppSidebar.tsx`). Una sola versión cubre frontend y
  backend juntos — no se versionan por separado, porque se liberan juntos.
- **Changelog:** `frontend-web/src/lib/changelog.ts`, arreglo `CHANGELOG`. Cada entrada:
  ```ts
  {
    version: '1.0.1',       // DEBE ser igual al version de package.json en esa liberación
    date: '2026-08-14',     // fecha real de la liberación, formato YYYY-MM-DD
    title: 'Título corto de la liberación',
    items: ['Cambio 1 en español llano...', 'Cambio 2...'],
  }
  ```
- **Cómo se muestra:** `ChangelogButton.tsx` → `ChangelogDialog`. Se auto-abre una vez por usuario
  cuando `user.last_seen_changelog_version` (guardado en su cuenta) no coincide con
  `LATEST_CHANGELOG_VERSION` (que es siempre `CHANGELOG[0].version`, la entrada más nueva). La
  comparación es por **igualdad exacta de string**, no por orden — así que el valor de `version` de
  cada entrada tiene que ser único y no reutilizarse nunca.
- **Cuántas se muestran:** el modal solo pinta las últimas `RECENT_CHANGELOG_COUNT` entradas
  (`getRecentChangelog()`), hoy en 3. `CHANGELOG` completo se queda como el histórico real y sigue
  creciendo — no hay que borrar entradas viejas, solo dejar que salgan del recorte.

## 2. Sacar los cambios reales, no de memoria

**Antes de escribir una sola línea del changelog, correr un diff contra la última liberación** —
nunca redactar a partir de lo que uno "recuerda" que se hizo en la conversación/sesión, porque eso
se olvida cosas o mezcla trabajo que todavía no se libera.

```bash
# Si el commit de la ultima liberacion esta tageado (ver paso 5), lo mas limpio:
git log v1.0.0..HEAD --oneline
git diff v1.0.0..HEAD --stat

# Si todavia no hay tags (proyecto nuevo, o se te olvido tagear la ultima vez),
# el equivalente es diffear contra el commit de esa liberacion a mano:
git log --oneline                      # ubicar el commit de la liberacion anterior
git diff <hash_de_esa_liberacion>..HEAD --stat
git log <hash_de_esa_liberacion>..HEAD --oneline
```

Con esa lista de commits/archivos tocados:

1. Agrupar por lo que el usuario **percibe**, no por archivo ni por commit — un mismo cambio de UX
   puede tocar 5 archivos (backend + frontend + tests) y ser una sola línea de changelog.
2. Descartar todo lo que no es visible para el usuario final (ver la lista de "qué NO entra" abajo).
3. Para cada cosa que sí queda, escribir una línea siguiendo las reglas de redacción (sección 3).

Si de verdad no hay ningún tag ni referencia de la liberación anterior, la comparación de emergencia
es contra la entrada más reciente de `CHANGELOG` por fecha (`git log --since=<esa fecha>`), pero es
menos preciso que un tag/commit exacto — evitarlo si se puede.

## 3. Reglas de redacción (el lenguaje)

El changelog lo lee alguien sin ningún contexto técnico. Cada línea tiene que poder entenderse sola.

**Sí:**
- Español neutro, tratamiento de **tú** (no "vos", aunque haya alguna entrada vieja así -- no
  perpetuarla).
- Hablar del beneficio o del comportamiento nuevo, no de la implementación: "ahora te avisa si..."
  en vez de "se agregó un chequeo de finish_reason".
- Una oración por punto, corta. Si hace falta más contexto, se puede usar un guion largo `--` para
  un dato extra, pero no párrafos.
- Nombrar la pantalla o la acción tal como la ve el usuario ("el modal de Registrar pago", "Asesor
  IA"), no el nombre del archivo/componente.
- Si es un bugfix visible, se puede nombrar el síntoma que ya no va a pasar ("ya no se queda
  bloqueado si...") en vez de explicar la causa técnica.

**No:**
- Nombres de archivos, funciones, variables, tools de IA, endpoints, tablas de la base de datos.
- Jerga (`linked_account_id`, `tool_calls`, `HTTPException`, `SSE`, `RLS`, `refactor`, `hook`).
- Cambios puramente internos: tests nuevos, refactors sin cambio de comportamiento, ajustes de
  compactación/espaciado menores, bumps de dependencias, comentarios de código.
- Mezclar dos cambios en una sola línea "y además también" — mejor dos líneas cortas.

**Ejemplos reales (de entradas ya escritas):**

| Mal (no usar así) | Bien (como se escribió) |
|---|---|
| "Se agregó la tool propose_action que no ejecuta writes" | "Cuando el asesor va a registrar algo por ti, ahora te lo confirma con una tarjeta y dos botones -- ya no hace falta escribirle 'sí'." |
| "Se corrigió el layout flex del chat (min-height/overflow)" | "El chat del asesor dejó de mover toda la pantalla al hacer scroll." |
| "create_debt ahora valida linked_account_id para type=credit_card" | "Si registrabas una tarjeta de crédito sin elegir su cuenta correspondiente, ahora te lo pedimos al crearla." |

### Qué SÍ entra al changelog

- Features nuevas que el usuario puede usar.
- Cambios de comportamiento visibles (aunque sea sutil, como un color o un mensaje distinto).
- Bugs corregidos que el usuario podía notar (algo que fallaba, se veía mal, o lo bloqueaba).
- Pantallas nuevas o eliminadas, o que cambiaron de lugar.

### Qué NO entra

- Compactaciones/ajustes visuales menores (padding, tamaños de fuente) salvo que sea un rediseño
  notorio de la pantalla completa.
- Tests, linting, tooling, CI, dependencias.
- Refactors internos sin cambio de comportamiento observable.
- Cambios de config/infra que no afectan lo que el usuario ve o puede hacer.

Ante la duda de si algo es lo bastante visible: si el usuario no tendría forma de notar la
diferencia usando la app normalmente, no va.

## 4. El título de la entrada

Una frase corta (5-10 palabras) que resuma el tema principal de la liberación, no una lista. Si hay
dos temas grandes, separarlos con coma: `"El asesor confirma con botones, y arreglos en Deudas"`.

## 5. Qué versión ponerle

`frontend-web/package.json` sigue semver de forma laxa (no hay una API pública con contrato que
romper, así que el criterio es sobre todo "qué tan grande se siente el cambio para quien usa la
app"):

- **Patch (`1.0.1` → `1.0.2`):** bugfixes, ajustes chicos, una feature menor.
- **Minor (`1.0.x` → `1.1.0`):** una feature nueva de tamaño real (una pantalla nueva, un flujo
  nuevo), o varios cambios patch acumulados que juntos se sienten como una liberación con contenido.
- **Major (`x.0.0`):** un rediseño grande o un cambio de fondo en cómo funciona algo central de la
  app. Poco frecuente.

Pasos concretos:

1. Decidir el bump (arriba) y actualizar `"version"` en `frontend-web/package.json`.
2. Usar ESE MISMO número como `version` de la nueva entrada en `CHANGELOG` (ver formato en la
   sección 1) -- nunca un valor distinto, y nunca una fecha disfrazada de versión.
3. `date` es la fecha real en la que se libera (no la fecha en que se escribió el código).
4. La nueva entrada va al **inicio** del arreglo `CHANGELOG` (índice 0) -- así queda como
   `LATEST_CHANGELOG_VERSION` automáticamente.

## 6. Tagear el commit de la liberación

Para que el próximo release pueda diffear limpio (ver sección 2), tagear el commit donde se sube la
versión y el changelog:

```bash
git tag v1.0.1
git push --tags   # si aplica
```

Si esto no se hizo en liberaciones pasadas, no pasa nada grave -- solo hay que ubicar el commit a
mano con `git log` la próxima vez. Pero de aquí en adelante, tagear siempre que se libere hace el
proceso mecánico en vez de depender de memoria.

## 7. Checklist resumida

1. `git log`/`git diff` contra el tag o commit de la última liberación -- nunca de memoria.
2. Agrupar por cambio percibido por el usuario, descartar lo interno (sección 3).
3. Redactar cada línea en español llano, tú, sin jerga, un cambio por línea.
4. Decidir el bump de versión (patch/minor/major) y actualizarlo en `frontend-web/package.json`.
5. Agregar la entrada nueva al inicio de `CHANGELOG` en `frontend-web/src/lib/changelog.ts`, con el
   mismo `version`, la fecha real, título corto, e items.
6. Correr `tsc --noEmit` (el array es TS, un error de tipeo en la forma del objeto lo agarra ahí).
7. Tagear el commit (`git tag vX.X.X`).
