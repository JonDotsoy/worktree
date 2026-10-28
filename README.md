# worktree

Extensión de Visual Studio Code para visualizar los git worktrees de un repositorio.

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
cada worktree con su rama (o commit si está *detached*) y su ruta.

El botón **Crear worktree** abre un formulario (rama, base y ruta opcionales) que llama a
`POST /api/worktrees`. Si la rama no existe se crea con `git worktree add -b`; la ruta
por defecto es una carpeta hermana del repo (`<repo>-<rama>`). El servidor
cierra al desactivar la extensión.

Otros scripts:

- `bun run build`: compila `src/extension.ts` a `dist/extension.js`.
- `bun run watch`: recompila al guardar.
- `bun run typecheck`: revisa los tipos con TypeScript.
- `bun test`: ejecuta los tests.

También puedes usar <kbd>F5</kbd> dentro de VS Code (configuración *Run Extension*).
