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

Otros scripts:

- `bun run build`: compila `src/extension.ts` a `dist/extension.js`.
- `bun run watch`: recompila al guardar.
- `bun run typecheck`: revisa los tipos con TypeScript.

También puedes usar <kbd>F5</kbd> dentro de VS Code (configuración *Run Extension*).
