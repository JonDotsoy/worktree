# Contribuir a Worktree

Gracias por tu interés en contribuir. Esta guía explica cómo preparar el entorno de desarrollo y cómo publicar una nueva versión de la extensión. Los commits y títulos de PR siguen [Conventional Commits](https://www.conventionalcommits.org/es/) y los PR se abren contra `develop`.

## Desarrollo

Requisitos: [Bun](https://bun.sh) y el comando `code` disponible en el `PATH`
(en VS Code: *Shell Command: Install 'code' command in PATH*).

```sh
bun install
bun ext:dev
```

`bun ext:dev` compila la extensión en `dist/` y abre una nueva ventana de VS Code
con la extensión cargada en modo desarrollo (`--extensionDevelopmentPath`). Verás el
icono de **Worktree** en la barra de actividades.

Al abrir la vista, la extensión levanta un servidor HTTP local (`127.0.0.1`, puerto
aleatorio) que sirve los archivos de `web/`, y los muestra en un webview dentro de la
barra lateral. La web consulta `GET /api/worktrees`, que ejecuta
`git worktree list --porcelain` en la primera carpeta abierta del workspace, y muestra
cada worktree con su rama (o commit si está *detached*), su ruta y la fecha de su último
commit, ordenados del commit más reciente al más antiguo.

Doble clic sobre un worktree (o el menú del clic secundario → **Abrir**) ejecuta
`code <path>`. Si el comando `code` no está en el `PATH`, se abre igual en una ventana
nueva de VS Code.

El botón **Crear worktree** abre un formulario (rama, base y ruta opcionales) que llama a
`POST /api/worktrees`. Si la rama no existe se crea con `git worktree add -b`; la ruta
por defecto es una carpeta hermana del repo (`<repo>-<rama>`). El servidor
cierra al desactivar la extensión.

Otros scripts:

- `bun run build`: compila `src/extension.ts` a `dist/extension.js`.
- `bun run watch`: recompila al guardar.
- `bun run typecheck`: revisa los tipos con TypeScript.
- `bun test`: ejecuta los tests.
- `bun run screenshots`: regenera las capturas de `docs/screenshots/` (crea un repo demo
  temporal, levanta la UI real y la captura con Playwright; define
  `PLAYWRIGHT_CHROMIUM_PATH` para usar otro Chromium).

También puedes usar <kbd>F5</kbd> dentro de VS Code (configuración *Run Extension*).

## Release

El workflow **Release** (`.github/workflows/release.yml`) se ejecuta a mano desde
*Actions → Release → Run workflow*. Elige `patch` (por defecto), `minor` o `major`, y el
workflow:

1. Revisa tipos y corre los tests.
2. Sube la versión en `package.json`.
3. Empaqueta la extensión con `vsce` (`worktree-<versión>.vsix`).
4. Hace commit de la versión (`chore(release): v<versión>`), crea el tag `v<versión>` y los sube a la rama elegida.
5. Crea el release en GitHub con el `.vsix` adjunto.

Para empaquetar localmente: `bun run package`.
