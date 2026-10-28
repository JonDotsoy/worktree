# Seguridad

Este documento describe lo que hace la extensión **Worktree** en tu equipo: qué archivos crea y lee, qué comandos ejecuta y qué expone en red. Refleja el código de `src/` y `web/`.

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad, escribe a **hi@jon.soy** con una descripción, los pasos para reproducirlo y la versión afectada. Por favor, no abras un issue público con los detalles hasta que haya una corrección.

## A quién notificar

- **Vulnerabilidades y parches de seguridad:** al mantenedor, [@JonDotsoy](https://github.com/JonDotsoy), en **hi@jon.soy**. Es la única persona responsable del proyecto y quien revisa cada pull request (ver `CODEOWNERS`).
- **Parches propuestos:** si ya tienes una corrección, descríbela en el mismo correo o envíala como pull request contra `develop` una vez acordada la divulgación. Hasta entonces, no la publiques.
- **Errores que no son de seguridad:** abre un issue en [github.com/JonDotsoy/worktree/issues](https://github.com/JonDotsoy/worktree/issues).

Las correcciones de seguridad se publican en una nueva versión de la extensión, que se descarga desde [Releases](https://github.com/JonDotsoy/worktree/releases).

## Resumen

- La extensión **no envía datos a internet**. No hay telemetría ni llamadas a servicios externos.
- Ejecuta únicamente `git` y, al abrir un worktree, `code`. Siempre con argumentos separados, **sin pasar por un shell**.
- Levanta un servidor HTTP local que escucha solo en `127.0.0.1`.

## Archivos y carpetas que crea o modifica

Todo ocurre dentro del repositorio abierto (la primera carpeta del espacio de trabajo).

| Ruta | Cuándo | Qué se escribe |
| --- | --- | --- |
| `<raíz del proyecto>/.worktree/` | Al crear el primer worktree con la carpeta por defecto | Carpeta que contiene los worktrees nuevos. |
| `<raíz del proyecto>/.worktree/.gitignore` | Junto a la carpeta anterior | Una línea `*`, para que git no liste su contenido. Solo se crea si no existe. |
| `<raíz del proyecto>/.worktree/<rama>/` | Al crear un worktree | Lo crea `git worktree add`. El nombre sale de la rama, con los caracteres que no sean `\w`, `.` o `-` cambiados por `-`. |
| Ruta indicada por ti | Al crear un worktree con una carpeta propia (ruta en el formulario o carpeta configurada) | Lo crea `git worktree add`. Se resuelve respecto al proyecto y puede ser absoluta o estar fuera del repositorio. |
| `.git/_worktree_configs/settings.json` | Al guardar la configuración | JSON con `baseBranch` y `worktreesDir`. En un worktree enlazado se usa el directorio git común, o sea el `.git` del worktree principal. |
| `.git/worktrees/…`, referencias y archivos `.git` de cada worktree | Al crear un worktree | Los escribe `git worktree add`, no la extensión directamente. |

La extensión **no modifica** tus archivos de código ni tu configuración de VS Code. Tampoco borra nada: no elimina worktrees, ramas ni carpetas.

## Archivos que lee

- `.git/_worktree_configs/settings.json`, para la rama base y la carpeta de worktrees.
- Los archivos estáticos de `web/` dentro de la extensión, que sirve el servidor local.
- La salida de `git`, que es de donde sale toda la información de worktrees y ramas.
- Vigila con `fs.watch` (recursivo) el directorio git común, para actualizar la lista cuando cambia. No lee el contenido de esos archivos: solo reacciona al evento y vuelve a ejecutar `git`.

## Comandos que ejecuta

Todos usan `execFile` o `spawn` con un arreglo de argumentos (sin `shell`), así que ni los nombres de ramas ni las rutas se interpretan como comandos de shell. El directorio de trabajo es el proyecto abierto.

| Comando | Para qué |
| --- | --- |
| `git worktree list --porcelain` | Listar los worktrees. |
| `git rev-parse --show-toplevel` | Saber cuál es el worktree actual. |
| `git rev-parse --path-format=absolute --git-common-dir` | Ubicar el directorio git común. |
| `git show -s --format=%H %ct <commits> --` | Fechas de commit, para ordenar la lista. |
| `git for-each-ref --format=%(refname:short) refs/heads refs/remotes` | Sugerir ramas. |
| `git rev-parse --verify --quiet refs/heads/<rama>` | Ver si una rama existe. |
| `git rev-parse --verify --quiet <base>^{commit}` | Validar la rama base al guardarla. |
| `git check-ref-format --branch <rama>` | Validar el nombre de la rama al crear un worktree. |
| `git worktree add -- <ruta> <rama>` | Crear un worktree de una rama existente. |
| `git worktree add -b <rama> -- <ruta> [<base>]` | Crear un worktree con una rama nueva. |
| `code <ruta>` | Abrir un worktree en una ventana nueva. |

Sobre `code <ruta>`:

- Se lanza con `spawn("code", [ruta], { detached: true, stdio: "ignore" })`, sin shell.
- Se le pasa el entorno del proceso sin las variables `VSCODE_*` ni `ELECTRON_RUN_AS_NODE`, para que se comporte como una invocación desde una terminal.
- Si `code` no está en el `PATH`, usa el comando interno `vscode.openFolder` en una ventana nueva.
- Solo se abren rutas que `git worktree list` reporta como worktrees del repositorio actual.

Validaciones: se rechazan nombres de rama y bases que empiecen por `-`, y se pasa `--` antes de las rutas para que git no las confunda con opciones.

## Servidor local

La vista de la barra lateral es un `iframe` que carga una página servida por la propia extensión.

- **Host y puerto:** `127.0.0.1`, puerto aleatorio asignado por el sistema operativo. No es accesible desde otras máquinas.
- **Cuándo:** se inicia al mostrar la vista por primera vez y se cierra cuando la extensión se desactiva.
- **Rutas:**
  - `GET /api/worktrees/events`: Server-Sent Events (SSE) con la lista de worktrees, el directorio del proyecto y tu directorio personal. Envía un latido cada 25 s.
  - `GET /api/worktrees`: la misma información en JSON.
  - `POST /api/worktrees`: crea un worktree.
  - `POST /api/worktrees/open`: abre un worktree (solo los listados por git).
  - `GET` y `PUT /api/settings`: lee y guarda la rama base y la carpeta de worktrees, y devuelve las ramas disponibles.
  - Cualquier otra ruta sirve archivos estáticos de `web/`, con control de que la ruta no salga de esa carpeta.
- **Protección de las escrituras:** los `POST` y `PUT` exigen `Host` igual a `127.0.0.1` o `localhost`, cabecera `Origin` igual a la del propio servidor y `Content-Type: application/json`. Eso evita que otros sitios web hagan cambios (CSRF) o usen DNS rebinding para escribir. El cuerpo está limitado a 64 KiB.
- **CORS:** no se envían cabeceras CORS.

### Limitaciones conocidas

- Los `GET` no tienen autenticación ni validan `Host` ni `Origin`. Cualquier proceso o usuario del mismo equipo que conozca el puerto puede leer la lista de worktrees (rutas, ramas, commits y tu directorio personal). Un sitio web no puede leerlos por CORS, pero un ataque de DNS rebinding podría hacerlo. Las operaciones que cambian algo sí están protegidas.
- Los `POST` y `PUT` tampoco llevan token. Un proceso local malicioso puede enviar el `Host` y el `Origin` correctos y crear worktrees o cambiar la configuración, pero eso ya exige ejecutar código en tu equipo.
- Si trabajas con VS Code remoto (SSH, contenedores, Codespaces), VS Code reenvía el puerto con `asExternalUri`. En ese caso el servidor corre en el equipo remoto.

## Portapapeles

El botón de copiar usa `navigator.clipboard.writeText` (con `document.execCommand("copy")` como alternativa) para copiar la ruta de un worktree. Solo **escribe** en el portapapeles al pulsar el botón; nunca lo lee.

## Red

La extensión no hace ninguna petición a servidores externos. La única comunicación es entre el `iframe` y el servidor local en `127.0.0.1`. La política de seguridad de contenido de la vista de VS Code solo permite cargar como marco el origen del servidor local.
