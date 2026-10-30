import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Prompts MCP que definen los flujos de trabajo del servidor. Son el guion que
 * el agente (Kiro) sigue cuando el usuario invoca explícitamente el MCP. No se
 * disparan solos: el usuario los elige, o el agente entra por `start` y
 * desambigua según el estado del workspace.
 *
 * Regla transversal: este MCP se usa SOLO cuando el usuario lo pide de forma
 * explícita. Si no lo indica, el agente no usa estas herramientas.
 */

const userMessage = (text: string) => ({
  messages: [
    {
      role: 'user' as const,
      content: { type: 'text' as const, text }
    }
  ]
})

export const START_GUIDE = `Eres Kiro conduciendo el MCP midd-nestjs-hexagonal-architecture (área Middleware).
El usuario invocó el MCP sin nombrar el flujo. Desambigua por el estado del workspace ANTES de actuar:

0. LEE LAS REGLAS PRIMERO: llama get_rules para cargar el cerebro de calidad del área
   (arquitectura hexagonal, naming, puertos inbound/outbound multi-método, JSON:API, errores,
   seguridad, complejidad). Son agnósticas de dominio y aplican tanto a greenfield como a refactor.
   Todo lo que generes o refactorices DEBE apegarse a esas reglas.
   Si el proyecto destino tiene docs/architecture-inventory.json, LÉELO también: te dice qué módulos
   ya existen (para no duplicarlos ni releer todo el código).
1. Inspecciona el workspace destino (usa la tool inspect_project si hay un proyecto):
   - ¿Existe un proyecto NestJS con lógica propia (src con controllers/services/módulos de negocio, package.json con @nestjs/*)?
   - inspect_project te dice si ya luce hexagonal, su convención de carpetas, su conexión y su infra existente.
2. Decide el flujo:
   - Workspace VACÍO o sin lógica NestJS de negocio  -> Flujo GREENFIELD (usa el prompt scaffold_greenfield).
   - Workspace con un NestJS ya existente y lógica   -> Flujo REFACTOR (usa el prompt refactor_to_hexagonal).
3. Si el estado es ambiguo (hay señales de ambos, o no está claro), PREGUNTA al usuario cuál flujo quiere. No adivines.

Recuerda: solo actúas con el MCP porque el usuario lo pidió explícitamente.`

export const GREENFIELD_GUIDE = `Flujo GREENFIELD del MCP midd-nestjs-hexagonal-architecture: crear un servicio NestJS hexagonal nuevo, funcional, que levante y conecte a BD.

Conduce así, paso a paso:

PASO 0 — LEE LAS REGLAS: llama get_rules y apégate a ellas (estructura hexagonal, naming,
  puertos inbound/outbound multi-método, DTOs JSON:API, acceso a datos TypeORM/SP, catálogo de
  errores, seguridad, complejidad). Son la fuente de verdad del estilo del área (destilado del canon).

PASO 1 — Pide al usuario estas variables (en un solo bloque) y espera su respuesta:
  Identidad de la API:
   - prefijoApi: prefijo de la API en kebab-case. Por ejemplo, midd-catalog. Los endpoints quedarán como /<prefijo>/api/v1/{recurso}
     (se guarda como API_CONTEXT). La versión vive en cada controller, NO en el prefijo global. Pregúntalo como "prefijo de la API".
   - La conexión NO se pregunta: se llama como su motor (Mssql, Postgres, Mysql) y se reutiliza si ya existe. Solo una conexión ADICIONAL
     de un motor que ya tiene una lleva número (Mssql2, Mssql3; inspect_project dice cuál toca) y solo si el usuario la pide.
   - motor: ¿qué motor de base de datos usa la API? mssql | postgres | mysql, o NINGUNO si no usa base de datos (se pasa motor="none"):
     entonces NO se genera ninguna conexión, ni módulo de BD, ni variables DB_*, ni driver. SIEMPRE pregúntalo, no lo asumas:
     de la respuesta depende el driver, la configuración de TypeORM y el dialecto de los stored procedures.
   - prefijoError: prefijo de errores de la API en mayúsculas. Por ejemplo, CATALOG. Los errores quedarán como
     CATALOG-PRODUCTNOTFOUND-001 (el número va de 001 a 999 y lo asigna el MCP en secuencia por prefijo).
  Base de datos (según el motor elegido):
   - DB_<CONEXION>_HOST, DB_<CONEXION>_PORT, DB_<CONEXION>_USERNAME, DB_<CONEXION>_PASSWORD, DB_<CONEXION>_NAME
     (p.ej. DB_CATALOG_HOST para la conexión "Catalog"). Una conexión adicional trae su propio juego de variables.
  API externa (si un caso consume una API en vez de una base de datos; es lo habitual si el servicio no usa BD):
   - Por cada API: su nombre (PascalCase, p.ej. "ExchangeRates"; su URL base va en EXCHANGE_RATES_BASE_URL) y, por cada método,
     el verbo (GET | POST | PUT) y la ruta. Estos casos usan adapterType="http" y no necesitan conexión ni motor.
  Servidor y seguridad (OBLIGATORIA):
   - PORT
   - CORS_ALLOWED_ORIGINS (lista de orígenes separados por coma): por defecto vale "*" (cualquier origen, tolerado para
     un middleware servidor-a-servidor). NO lo preguntes ni lo cambies: déjalo en "*". Solo si el usuario ya tiene los
     orígenes reales, ponlos en esa variable del .env; no requiere tocar código.
   - Los parámetros de rate limiting (RL_*) traen defaults del área (150 req/5 s por IP, 20 concurrentes, 8 MB / 2 MB json);
     solo pregunta si el usuario quiere cambiarlos.
  Autorización (SIEMPRE PREGUNTA, no la decidas tú ni la omitas en silencio):
   - "¿Este servicio exige autorización de los requests? (sí/no)". Si dice que sí, pide también la URL base de la
     API de autorización. Si dice que no, no la generes y deja constancia en el reporte final.
  - Si ya hay un middleware.spec.yaml confirmado (lo arma el agente middleware-generator): llama generate_from_spec
    con dryRun=false y NO uses un caso de ejemplo. El spec ya contesta lo que el PASO 1 pregunta; no lo repitas.
  - Si NO hay spec: llama add_use_case con un caso de uso de ejemplo (el recurso da igual; sirve para que el servicio nazca completo).
    add_use_case registra el dominio en app.module.ts automáticamente (no hace falta editar a mano).
  - Si el usuario pidió autorización: llama add_authorization (projectRoot, authorizationApiUrl). Se crea UNA vez por
    servicio, la registra después de SecurityModule y agrega AUTHORIZATION_API_URL a Joi, config y .env.example.

PASO 2 — Genera la base:
  - Llama scaffold_service con projectRoot, motor, prefijoApi, prefijoError (sin conexion: la nombra el motor).
    (Genera shared + config + main.ts + app.module.ts con la conexión ya cableada, y .env.example desde el joiSchema.)
  - Llama add_use_case con un caso de uso de ejemplo (el recurso da igual; sirve para que el servicio nazca completo).
    add_use_case registra el dominio en app.module.ts automáticamente (no hace falta editar a mano).

PASO 3 — Prepara el proyecto:
  - Fusiona templates/config/package.snippet.json en el package.json del servicio (get_template para leerlo).
  - NO agregues axios ni uuid (están prohibidos): HTTP con fetch nativo (consumoHttp) y ids con randomUUID de node:crypto.
  - Crea TÚ el .env a partir de .env.example (sin pisar uno existente) con los valores REALES que dio el usuario en el PASO 1; nunca
    le pidas al usuario que lo haga. No repitas contraseñas en tus respuestas. Antes comprueba que .gitignore ignora .env.
  - Corre TÚ (shell): npm install, luego npm run build.

PASO 4 — Valida conexión a BD POR ARRANQUE (lo más simple):
  - Arranca el servicio en segundo plano (p.ej. npm run start) y lee los logs unos segundos.
  - TypeORM conecta al bootear; si falla la conexión (login/timeout), Nest NO completa el arranque y el proceso cae.
    => Proceso vivo + bootstrap de Nest completo (sin error de conexión) = BD conectada OK.
    => Proceso caído o error de login/timeout a la base de datos = BD NO conectó: corrige host/credenciales en .env y reintenta.
  - No añadas scripts de ping ni drivers extra: el arranque es el validador.
  - Confirma que el HTTP quedó arriba con el health que trae el servicio: POST /<prefijoApi>/api/v1/health con la
    cabecera Content-Type: application/vnd.api+json. Debe responder 200 con status UP. Sigue siendo público aunque
    actives la autorización (add_authorization lo marca con @SkipAuthorization).

PASO 5 — Cierra con verify_standards. Reporta al usuario el resultado (levantó y conectó, o qué falló).
  Si hay errores bloqueantes, corrígelos (cada uno trae un ID de regla estable) y vuelve a verificar hasta quedar en verde.
  NO desactives ni debilites una regla de seguridad para que pase: corrige el código.
  AVISO OBLIGATORIO DE TODOs: al terminar, lista al usuario TODO lo que quedó como TODO/NOTA o por confirmar
  (reglas de negocio inferidas, columnas o tipos sin validar contra el esquema real, valores faltantes), archivo por archivo.
  Un TODO silencioso es un defecto.

PASO 6 — MEMORIA DEL REPO (inventario + auditoría): si generaste con generate_from_spec, el inventario
  ya quedó registrado. Corre record_architecture(projectRoot, specPath, compliance, buildStatus, decisions)
  para escribir docs/audits/<module>-<fecha>.md con el resultado de build y verify. La misma llamada regenera desde el código el contrato (src/<modulo>/contracts) y el diagrama Mermaid (src/<modulo>/diagrams) del módulo.
  DOCUMENTACIÓN OPCIONAL (pregunta al usuario, no la decidas tú): "¿Genero la colección de Postman?" y "¿Genero docs/ARCHITECTURE.md con el diagrama general (architecture-beta)?". Si dice que sí, llama generate_api_docs con postman=true y/o architecture=true; desde ahí el MCP las mantiene al día. Esto deja memoria del
  módulo para sesiones futuras.`

export const REFACTOR_GUIDE = `Flujo REFACTOR del MCP midd-nestjs-hexagonal-architecture: tomar un proyecto NestJS existente (lógica plana) y convertirlo a arquitectura hexagonal del área, RESPETANDO las reglas del proyecto destino.

Asume siempre NestJS. El refactor NO es un greenfield: el proyecto YA tiene convención de carpetas, infraestructura transversal y configuración de conexión propias. NO las impongas desde el dataset: descúbrelas y adáptate. El "cerebro" del refactor eres tú (mueves la lógica real); el MCP aporta los moldes y la verificación.

PASO 0a — LEE LAS REGLAS DEL ÁREA: llama get_rules para cargar las convenciones hexagonales y de
  calidad (agnósticas de dominio, destiladas del canon). Son el objetivo de calidad al que debe
  converger el refactor. Cuando choquen con la convención del proyecto destino, respeta la del
  proyecto en lo estructural (carpetas/nombres existentes) pero aplica las reglas de calidad del área
  (puertos inbound/outbound, errores, seguridad, JSON:API).

PASO 0b — DESCUBRE las reglas del workspace (OBLIGATORIO, antes de generar nada):
  - Llama inspect_project(projectRoot). Te reporta: convención de carpetas/case de dominios, forma de la conexión TypeORM (forRoot por defecto vs nombradas, replication), infra transversal existente (JSON:API response, tipo de error, middleware, ConfigurationVariables) y módulos presentes.
  - Esas son las REGLAS que debes respetar en todo lo que sigue.

PASO 1 — ANALIZA la lógica actual:
  - Lee controllers, services, módulos, DTOs, entidades y acceso a datos.
  - Identifica los casos de uso reales (cada endpoint / operación de negocio).
  - Por cada caso mapea: entrada (attributes), lógica de negocio, acceso a datos (repositorio TypeORM o stored procedure), y qué infra transversal usa.

PASO 2 — GENERA el slice hexagonal en MODO REFACTOR:
  - Llama add_use_case con mode="refactor" y connectionStyle según inspect_project ("default" si la conexión es forRoot sin nombre; "named" si hay <X>Connection).
  - Usa como "dominio" el nombre de la carpeta existente CON SU MISMO CASE (p.ej. "setups" en minúscula si así está en el proyecto), para no colisionar en Windows (case-insensitive).
  - En modo refactor, add_use_case NO toca app.module ni los módulos del proyecto, y el adapter NO inyecta conexión nombrada si connectionStyle="default".
  - NO corras scaffold_service sobre un proyecto que ya tiene su capa shared/infra: duplicaría e incluso rompería lo existente. scaffold_service es solo para greenfield.

PASO 3 — MUEVE la lógica real a las piezas generadas:
  - Lógica de negocio del service plano -> domain service / application service.
  - Acceso a datos -> adapter (TypeORM) o adapter SP (adapterType="sp", nombreSp) si el original ejecutaba un stored procedure.
  - Entrada del caso -> entidad de dominio de request (core); el DTO con validación queda en infrastructure.
  - REUSA la infraestructura transversal del proyecto que reportó inspect_project (su ResponseJsonApi, su tipo de error, su middleware). BORRA del slice los archivos del dataset que dupliquen infra ya existente (p.ej. catálogos/errores/shared que el proyecto ya resuelve de otra forma).

PASO 4 — CABLEA respetando el proyecto:
  - Registra el controller/providers del caso en el módulo EXISTENTE del dominio (o crea el módulo hexagonal y enlázalo en app.module) siguiendo la convención del proyecto, no la del dataset.
  - Mantén el contrato JSON:API y @Version del proyecto.

PASO 5 — COMPUERTA:
  - npm run build + npm test si hay tests.
  - verify_standards sobre el proyecto. Corrige hasta que pase sin errores bloqueantes.

Reglas de oro: (1) descubre antes de generar; (2) adáptate a la convención del proyecto, no al revés; (3) reusa la infra existente, no la dupliques; (4) preserva el comportamiento, no inventes lógica; (5) no toques a ciegas módulos ajenos. Pregunta al usuario cuando un mapeo sea ambiguo.`

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'start',
    {
      title: 'Iniciar MCP (desambiguar flujo)',
      description:
        'Punto de entrada del MCP midd-nestjs-hexagonal-architecture. Detecta el estado del workspace y encamina a greenfield (crear servicio) o refactor (convertir a hexagonal).'
    },
    () => userMessage(START_GUIDE)
  )

  server.registerPrompt(
    'scaffold_greenfield',
    {
      title: 'Crear servicio NestJS hexagonal nuevo',
      description:
        'Guía el flujo de creación de un servicio nuevo: pide variables, genera con scaffold_service + add_use_case + .env, instala, compila y valida la conexión a BD arrancando el servicio.'
    },
    () => userMessage(GREENFIELD_GUIDE)
  )

  server.registerPrompt(
    'refactor_to_hexagonal',
    {
      title: 'Refactor NestJS a hexagonal',
      description:
        'Guía el flujo de refactor: lee un NestJS existente, mapea su lógica a slices hexagonales con las herramientas del MCP, y valida con build + verify_standards.'
    },
    () => userMessage(REFACTOR_GUIDE)
  )
}
