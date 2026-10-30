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

Tras bambalinas trabaja con dos sub-agentes que **no debes seleccionar**:
`middleware-gen-worker` (barato, completa el andamiaje) y `middleware-auditor` (premium, valida y deja la
auditoria). Los tres se instalan y se actualizan juntos con `install_agentic_kit`.

### Decisiones guardadas (a la vista)
El agente pregunta UNA vez por repo la autorizacion y Postman, y guarda tu respuesta en el bloque
`midd-nestjs-preferences` de este mismo archivo (`AUTHORIZATION:`, `POSTMAN:`). `undefined` es que todavia no se
pregunto. Para cambiar una decision edita su valor; el agente la respeta sin volver a preguntar.
### Reglas para cualquier agente
0. **Si no eres el agente `middleware-generator`, no generes un servicio ni un modulo por tu cuenta.** Ese agente es el que hace las
   preguntas y corre el flujo completo. Dile al usuario que lo seleccione en el selector de agentes del chat y que repita su pedido.

1. **Valida el MCP primero.** Llama `get_rules`. Si falla o viene vacio, **detente**: no escribas codigo del
   modulo, no uses lo que recuerdes de la arquitectura ni hagas un "mejor esfuerzo". Revisa
   `.kiro/settings/mcp.json`.
2. **Consulta `get_learnings` justo despues de `get_rules`.** Son datos consultivos de este repo (convenciones,
   decisiones del usuario, errores que se repiten): sirven para proponer defaults y nunca sustituyen ni relajan
   las reglas base.
3. **No escribas a mano un modulo** de middleware: se genera con las herramientas del MCP.
4. **Antes de generar, lee `docs/architecture-inventory.json`** (si existe) para saber que modulos ya hay.
5. **Termina siempre con `verify_standards` en verde y un build real**, y registra el modulo con
   `record_architecture`. No se entrega un modulo que no se vio compilar.
6. Dependencias prohibidas: `axios` (usa `fetch` nativo) y `uuid` (usa `randomUUID` de `node:crypto`).
7. Al terminar, **avisa al usuario de todo TODO o pendiente** que haya quedado, archivo por archivo.

### Version

| Artefacto | Version |
|-----------|---------|
| midd-nestjs-hexagonal-architecture-mcp | `__MCP_VERSION__` |

Si el MCP en uso es mas nuevo que esta version, avisa al usuario y sugiere ejecutar `install_agentic_kit`.
No actualices por tu cuenta.
