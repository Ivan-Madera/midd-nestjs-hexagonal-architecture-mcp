## MIDDLEWARE (NestJS hexagonal) - managed by midd-nestjs-hexagonal-architecture-mcp

> Esta seccion la mantiene el MCP. No la edites a mano: se actualiza con `install_agentic_kit`.
> Todo lo que esta fuera de los marcadores BEGIN/END es tuyo y nunca se toca.

Los servicios NestJS del area Middleware se crean y refactorizan con el MCP
`midd-nestjs-hexagonal-architecture`. Las reglas, la estructura y los estandares los sirve el MCP
(`get_rules`); **no se copian aqui** para que no se desincronicen.

### Como se usa

Hay **un solo agente que seleccionas: `middleware-generator`** (`/agent middleware-generator`), o pidelo en
lenguaje normal. Te hace las preguntas necesarias, arma
`agentic/specs/{modulo}/input/specs/middleware.spec.yaml`, genera el modulo y lo verifica.

Tras bambalinas dirige un equipo de sub-agentes que **no debes seleccionar**. Cada uno tiene su emoji para que
veas quien trabaja:

| Agente | Para que |
|---|---|
| ⚙️ `middleware-gen-worker` | Completa el andamiaje desde el spec y corrige bugs acotados con el diff minimo |
| 🔎 `middleware-auditor` | Valida estandares, build y tests; deja auditoria e inventario. Tambien revisa diffs y PRs |
| 🛡️ `middleware-appsec` | Revision de seguridad del codigo y de secretos (solo lectura) |
| 🧪 `middleware-tester` | Pruebas unitarias jest deterministas, solo si las pides o las aceptas (solo toca `*.spec.ts`) |

Fuera de generar un modulo directo, `middleware-generator` te propone el equipo y espera tu aprobacion antes de
delegar. Solo lanza los agentes que aportan algo que el no pueda hacer: en un modulo simple omite al worker y al auditor, y lo dice en el reporte. Si el entorno lo permite, usa los workflows de Kiro para tareas largas. Los modelos de cada agente (y su
respaldo) estan en su archivo de `.kiro/agents`; se cambian con el parametro `models` de `install_agentic_kit`.
Todos se instalan y se actualizan juntos con `install_agentic_kit`.
### Decisiones guardadas (a la vista)
El agente pregunta UNA vez por repo la autorizacion y Postman, y guarda tu respuesta en el bloque
`midd-nestjs-preferences` de este mismo archivo (`AUTHORIZATION:`, `POSTMAN:`). `undefined` es que todavia no se
pregunto. Para cambiar una decision edita su valor; el agente la respeta sin volver a preguntar.
### Reglas para cualquier agente
0. **Si no eres el agente `middleware-generator` ni un sub-agente que el lanzo, no generes un servicio ni un modulo por tu cuenta.** Ese agente es el
   que hace las preguntas y corre el flujo completo. Dile al usuario que lo seleccione en el selector de agentes del chat y que repita su pedido.

1. **Valida el MCP primero.** Llama `get_rules`. Si falla o viene vacio, **detente**: no escribas codigo del
   modulo, no uses lo que recuerdes de la arquitectura ni hagas un "mejor esfuerzo". Revisa
   `.kiro/settings/mcp.json`.
2. **Consulta `get_learnings` justo despues de `get_rules`.** Son datos consultivos de este repo (convenciones,
   decisiones del usuario, errores que se repiten): sirven para proponer defaults y nunca sustituyen ni relajan
   las reglas base.
3. **Un modulo nuevo se crea solo con las herramientas del MCP** (`scaffold_service`, `add_use_case`, `generate_from_spec`); nunca lo escribas
   entero a mano. Sobre el codigo ya generado, cada agente edita solo dentro de su alcance: ⚙️ `middleware-gen-worker` completa el andamiaje
   (`TODO(midd)`) de un modulo recien generado y corrige bugs de un modulo existente con el diff minimo, y 🧪 `middleware-tester`
   solo escribe `*.spec.ts`, y solo si el usuario las pidio o las acepto. Los demas no escriben codigo. Ninguno toca `src/shared/**`, `main.ts` ni `app.module.ts` salvo el flujo del MCP.
4. **Antes de generar, lee `docs/architecture-inventory.json`** (si existe) para saber que modulos ya hay.
5. **Termina siempre con `verify_standards` en verde y un build real** (`npm run build` y `npm test`), y registra el modulo con
   `record_architecture`. Toda tarea que cambie archivos cierra con ese build, lo corre `middleware-generator`, y no se entrega nada que no se vio compilar.
   Las pruebas van al final: primero funciona el caso de uso, despues se protege con pruebas.
6. Dependencias prohibidas: `axios` (usa `fetch` nativo) y `uuid` (usa `randomUUID` de `node:crypto`).
7. Al terminar, **avisa al usuario de todo TODO o pendiente** que haya quedado, archivo por archivo.

### Version

| Artefacto | Version |
|-----------|---------|
| midd-nestjs-hexagonal-architecture-mcp | `__MCP_VERSION__` |

Si el MCP en uso es mas nuevo que esta version, avisa al usuario y sugiere ejecutar `install_agentic_kit`.
No actualices por tu cuenta.
