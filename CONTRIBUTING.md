# Contribuir a Worktree

Gracias por tu interés en mejorar Worktree. Esta guía explica cómo preparar el entorno,
cómo está organizado el código, qué convenciones seguimos y cómo se publica una versión.

- [Requisitos](#requisitos)
- [Primeros pasos](#primeros-pasos)
- [Scripts](#scripts)
- [Cómo funciona la extensión](#cómo-funciona-la-extensión)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Commits y pull requests](#commits-y-pull-requests)
- [Release](#release)

## Requisitos

- [Bun](https://bun.sh).
- VS Code 1.90 o superior.
- El comando `code` disponible en el `PATH` (en VS Code: *Shell Command: Install 'code'
  command in PATH*).

## Primeros pasos

```sh
git clone https://github.com/JonDotsoy/worktree.git
cd worktree
bun install
bun ext:dev
```

`bun ext:dev` compila la extensión en `dist/` y abre una nueva ventana de VS Code con la
extensión cargada en modo desarrollo (`--extensionDevelopmentPath`). Verás el icono de
**Worktree** en la barra de actividades.

También puedes pulsar <kbd>F5</kbd> dentro de VS Code (configuración *Run Extension*),
que compila antes de lanzar y permite depurar con puntos de interrupción.

## Scripts

| Comando                  | Qué hace                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `bun ext:dev`            | Compila y abre VS Code con la extensión en modo desarrollo.              |
| `bun run build`          | Compila `src/extension.ts` a `dist/extension.js`.                        |
| `bun run watch`          | Recompila al guardar.                                                    |
| `bun run typecheck`      | Revisa los tipos con TypeScript.                                         |
| `bun test`               | Ejecuta los tests.                                                       |
| `bun run screenshots`    | Regenera las capturas de `docs/screenshots/`.                            |
| `bun run icon`           | Regenera `media/icon.png` a partir de `media/worktree.svg`.              |
| `bun run package`        | Empaqueta la extensión en un `.vsix` con `vsce`.                         |

`bun run screenshots` crea un repo demo temporal, levanta la UI real y la captura con
Playwright. Igual que `bun run icon`, acepta la variable `PLAYWRIGHT_CHROMIUM_PATH` para
usar otro Chromium.

Antes de abrir un PR, asegúrate de que pasen `bun run typecheck` y `bun test`: son los
mismos chequeos que corre el workflow de release.

## Cómo funciona la extensión

Al abrir la vista, la extensión levanta un servidor HTTP local (`127.0.0.1`, puerto
aleatorio) que sirve los archivos de `web/`, y los muestra en un webview dentro de la
barra lateral. El servidor se cierra al desactivar la extensión.

- **Listar.** La web consulta `GET /api/worktrees`, que ejecuta
  `git worktree list --porcelain` en la primera carpeta abierta del workspace, y muestra
  cada worktree con su rama (o commit si está *detached*), su ruta y la fecha de su
  último commit, ordenados del commit más reciente al más antiguo.
- **Abrir.** Doble clic sobre un worktree (o el menú del clic secundario → **Abrir**)
  ejecuta `code <path>`. Si el comando `code` no está en el `PATH`, se abre igual en una
  ventana nueva de VS Code.
- **Crear.** El botón **Crear worktree** abre un formulario (rama, base y ruta opcionales)
  que llama a `POST /api/worktrees`. Si la rama no existe se crea con
  `git worktree add -b`; la ruta por defecto es `.worktree/<rama>` dentro del repo
  principal (la carpeta se puede cambiar en la configuración).

La API también expone `/api/worktrees/open`, `/api/worktrees/description`,
`/api/worktrees/events` y `/api/settings`; todas están en `src/server.ts`.

Qué archivos crea y qué comandos ejecuta la extensión está detallado en
[SECURITY.md](SECURITY.md); actualízalo si tu cambio agrega comandos o accesos nuevos.

## Estructura del proyecto

```text
src/
  extension.ts   Punto de entrada: registra la vista y arranca el servidor.
  server.ts      Servidor HTTP local y la API /api/worktrees.
  worktrees.ts   Lectura y creación de worktrees con git.
  *.test.ts      Tests (bun test).
web/             UI del webview (index.html).
media/           Iconos de la extensión.
scripts/         Generación de capturas e icono.
docs/            Capturas usadas en el README.
DESIGN.md        Referencia de estilo visual de la UI.
```

## Commits y pull requests

- Los commits y títulos de PR siguen [Conventional Commits](https://www.conventionalcommits.org/es/):
  `feat:`, `fix:`, `docs:`, `ci:`, `chore:`… Por ejemplo, `fix: abrir worktree con espacios en la ruta`.
- Trabaja en una rama propia y abre el PR contra `develop`.
- Incluye tests cuando cambies la lógica de `src/`.
- Si cambias la UI, regenera las capturas con `bun run screenshots` e inclúyelas en el PR.
- Para reportar una vulnerabilidad, sigue [SECURITY.md](SECURITY.md) en lugar de abrir un
  issue público.

## Release

El workflow **Release** (`.github/workflows/release.yml`) se ejecuta a mano desde
*Actions → Release → Run workflow*. Elige `patch` (por defecto), `minor` o `major`, y el
workflow:

1. Revisa tipos y corre los tests.
2. Sube la versión en `package.json`.
3. Empaqueta la extensión con `vsce` (`worktree-<versión>.vsix`).
4. Hace commit de la versión (`chore(release): v<versión>`), crea el tag `v<versión>` y
   los sube a la rama elegida.
5. Crea el release en GitHub con el `.vsix` adjunto y notas generadas automáticamente.

Para empaquetar localmente: `bun run package`.
