#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { scaffoldService, scaffoldServiceSchema } from './tools/scaffold.js'
import { addUseCase, addUseCaseSchema } from './tools/addUseCase.js'
import { generateFromSpec, generateFromSpecSchema } from './tools/generateFromSpec.js'
import { recordArchitecture, recordArchitectureSchema } from './tools/architecture.js'
import { addAuthorization, addAuthorizationSchema } from './tools/addAuthorization.js'
import { generateApiDocsTool, generateApiDocsSchema } from './tools/apiDocs.js'
import { getLearnings, getLearningsSchema, recordDecision, recordDecisionSchema } from './tools/learnings.js'
import {
  installAgenticKitTool,
  installAgenticKitSchema,
  getFlow,
  getFlowSchema
} from './tools/agentic.js'
import {
  verifyStandards,
  verifyStandardsSchema,
  listTemplates,
  listTemplatesSchema,
  getTemplate,
  getTemplateSchema,
  inspectProjectTool,
  inspectProjectSchema,
  getRules,
  getRulesSchema
} from './tools/support.js'
import { adoptSharedLayer, adoptSharedLayerSchema } from './tools/adoptShared.js'
import { registerPrompts } from './prompts.js'
import { withKit } from './tools/kit.js'

const server = new McpServer({
  name: 'midd-nestjs-hexagonal-architecture-mcp',
  version: '0.1.0'
})

// --- Flujos de trabajo (prompts MCP) ---------------------------------------
registerPrompts(server)

// --- Scaffolding grande -----------------------------------------------------
server.tool(
  'scaffold_service',
  'Genera la base de un servicio NestJS hexagonal nuevo: capa shared completa (JSON:API, errores, logger, config+Joi, database-context, utils), archivos de config/enforcement (eslint, prettier, Dockerfile, verify-standards, hooks husky), main.ts y app.module.ts canónicos. Escribe en projectRoot. OBLIGATORIOS y SIEMPRE se le preguntan al usuario (no se inventan ni tienen valor por defecto): prefijoApi, prefijoError y motor (mssql | postgres | mysql | none); si falta alguno la herramienta no genera nada y dice cuál preguntar.',
  scaffoldServiceSchema,
  withKit({ creates: true, entry: true, gate: true }, scaffoldService)
)

// --- Refactor: la capa compartida del estandar en un proyecto existente -----
server.tool(
  'adopt_shared_layer',
  'REFACTOR. Trae a un proyecto NestJS EXISTENTE la capa compartida obligatoria del area (seguridad: rate limit C1/C2/C3, Cache-Control, helmet, CORS; correlation id; configuracion tipada + Joi con los defaults del area; filtro de errores JSON:API; health; utils con HttpClientService y DatabaseCommonService) en src/shared, sin pisar nada: escribe solo los archivos que faltan, agrega a package.json y .env.example solo lo que falta y reporta la infra propia del proyecto, las dependencias prohibidas y las decisiones pendientes (rutas, content type). main.ts y app.module.ts son del proyecto: solo los toca con patchEntry=true, que el agente pasa DESPUES de que el usuario acepto; si no, devuelve los cambios exactos. Usala en el refactor en vez de scaffold_service y en vez de escribir la seguridad a mano.',
  adoptSharedLayerSchema,
  withKit({ entry: true, gate: true }, adoptSharedLayer)
)

// --- Vertical slice completa ------------------------------------------------
server.tool(
  'add_use_case',
  'Genera un caso de uso completo (vertical slice hexagonal) en un dominio: puerto inbound/outbound, domain service, application service + interface + spec, adapter (TypeORM por defecto; SP opt-in con nombreSp), controller JSON:API + DTOs, entidad de dominio y TypeORM, catálogos de error, y los módulos del dominio. Escribe en src/<dominio>/ (carpeta siempre lowercase; las clases salen en PascalCase sin importar el case de "dominio"). ' +
    'MULTI-CASO: al añadir el 2º/3er caso al MISMO dominio, el MCP MERGEA ese caso en los módulos del dominio ya generados (controller, adapter, providers, tokens, forFeature) — tanto en greenfield como en refactor. En refactor NUNCA toca app.module (eso lo cablea el agente). ' +
    'API EXTERNA: con adapterType="http" (apiExterna, rutaApi, metodoHttp) el caso consume una API con el fetch nativo y NO necesita base de datos, conexion ni motor; declara <API>_BASE_URL en config, Joi y .env.example. SP: con adapterType="sp" el wiring es quirúrgico — apunta el módulo al .sp.adapter y quita del forFeature SOLO la entidad de ese caso, preservando las de los casos TypeORM. ' +
    'INFRA (refactor): primero adopt_shared_layer deja la capa shared del estandar en src/shared; con ella usa infraStyle="dataset". Solo si el proyecto conserva su propia infra en otra carpeta (la que reporta inspect_project), usa infraStyle="project" + ese infraRoot y concilia a mano los NOMBRES de clase.',
  addUseCaseSchema,
  withKit({ gate: true }, addUseCase)
)

// --- Aprendizajes por repo (consultivos; nunca cambian las reglas base) ----
server.tool(
  'get_learnings',
  'Devuelve lo que el MCP recuerda de ESTE repo por usos anteriores: convenciones (contexto del servicio, prefijos de error y conexiones ya usados), decisiones que el usuario tomo una vez (autorizacion) y los errores del verificador que se repiten en este repo. Es SOLO LECTURA y CONSULTIVO: no sustituye ni relaja las reglas base (get_rules) ni el verificador. Llamala justo despues de get_rules y usa los datos para PROPONER defaults que el usuario confirma. Si no hay nada util, lo dice y no pasa nada.',
  getLearningsSchema,
  getLearnings
)
server.tool(
  'record_decision',
  'Registra una decision que el USUARIO tomo de forma explicita y que vale para todo el repo, para no volver a preguntarla en la siguiente sesion. Lista cerrada: authorization = enabled | disabled. Solo con una respuesta clara del usuario; nunca por suposicion del agente. Escribe en docs/mcp-learnings.json.',
  recordDecisionSchema,
  recordDecision
)

// --- Capa agéntica mínima: punto de entrada igual para todos los repos ------
server.tool(
  'install_agentic_kit',
  'Instala (o actualiza) en el repo consumidor el punto de entrada del MCP: los agentes middleware-generator (el unico que se selecciona), middleware-gen-worker y middleware-auditor (.kiro/agents), la plantilla del middleware.spec.yaml (agentic/templates) y la sección del MCP en AGENTS.md (entre marcadores BEGIN/END; el resto del archivo no se toca). Idempotente: volver a correrla actualiza a la versión del MCP. Un archivo con el mismo nombre que no instaló este MCP se respeta salvo overwrite=true. Úsala cuando el usuario quiera dejar el repo listo para crear servicios con el MCP.',
  installAgenticKitSchema,
  installAgenticKitTool
)
server.tool(
  'get_flow',
  'Devuelve el procedimiento paso a paso de un flujo (start | greenfield | refactor). Es la ÚNICA fuente del procedimiento: la comparten los prompts del MCP y el agente spec-builder-middleware instalado, para que no haya copias que se desincronicen.',
  getFlowSchema,
  getFlow
)

// --- Autorización del borde HTTP (OPT-IN: el agente pregunta si se activa) ---
server.tool(
  'add_authorization',
  'OPT-IN. Agrega la autorización del borde HTTP al servicio: puerto agnóstico IAuthorizationVerifier + adapter por defecto (API de autorización) + Guard GLOBAL, secure-by-default (todo endpoint protegido salvo @SkipAuthorization()) y FAIL-CLOSED (denegado o autorizador inalcanzable = 403). El agente DEBE PREGUNTAR al usuario si quiere activarla; nunca decide solo ni la omite en silencio. Se crea UNA vez por servicio en src/shared/authorization. Parchea ConfigurationVariables, el schema Joi, .env.example y app.module (la registra DESPUÉS de SecurityModule para que el rate limit corra primero). Idempotente.',
  addAuthorizationSchema,
  withKit({ gate: true }, addAuthorization)
)

// --- Generación declarativa desde spec -------------------------------------
server.tool(
  'generate_from_spec',
  'Genera un módulo hexagonal a partir de un middleware.spec.yaml declarativo (agnóstico de dominio: module/entity/use_cases los define el usuario en el spec). Soporta casos de uso con N métodos por puerto (inbound/outbound). Con dryRun=true (default) valida el spec y devuelve el PLAN de generación (casos, métodos, archivos) SIN escribir disco; con dryRun=false genera el slice por cada caso reutilizando add_use_case. Respeta las reglas de get_rules.',
  generateFromSpecSchema,
  withKit({ entry: true, gate: true, skip: (a) => a.dryRun === true }, generateFromSpec)
)

// --- Inventario + auditoría de arquitectura --------------------------------
server.tool(
  'record_architecture',
  'Registra un módulo en docs/architecture-inventory.json (envelope con mcpVersion/generatedAt; una entrada por módulo, sin tocar las de otros) y escribe docs/audits/<module>-<fecha>.md. Lee el middleware.spec.yaml del módulo para no duplicar datos; acepta compliance (salida de verify_standards), estado de build y decisiones. Es la memoria por repo del MCP: léela al abrir una sesión futura para no duplicar módulos.',
  recordArchitectureSchema,
  recordArchitecture
)

// --- Documentacion de la API generada desde el codigo ----------------------
server.tool(
  'generate_api_docs',
  'Genera la documentacion de la API LEYENDO EL CODIGO REAL (controllers, DTOs, catalogos de error), nunca de memoria. Siempre: contrato por modulo (src/<modulo>/contracts/<modulo>.api.md), diagrama Mermaid sequenceDiagram por modulo (src/<modulo>/diagrams/<modulo>.flow.mmd) e indice docs/api/README.md, mas docs/ARCHITECTURE.md (diagrama Mermaid architecture-beta; siempre, no se pregunta). Opt-in (el agente PREGUNTA al usuario): postman=true crea docs/api/middleware.postman_collection.json (una coleccion, una carpeta por modulo, fusion sin tocar las demas). Idempotente y determinista; add_use_case y record_architecture la refrescan solos.',
  generateApiDocsSchema,
  generateApiDocsTool
)
// --- Verificación / soporte -------------------------------------------------
server.tool(
  'verify_standards',
  'Ejecuta la verificación de estándares (naming, cabeceras de seguridad, @Version, .env.example, SP opt-in) sobre el proyecto destino. Devuelve el reporte; falla si hay errores bloqueantes.',
  verifyStandardsSchema,
  verifyStandards
)
server.tool(
  'get_rules',
  'Devuelve el cerebro de calidad del área (rules.yaml): las convenciones de arquitectura hexagonal, naming, puertos inbound/outbound multi-método, DTOs JSON:API, acceso a datos (TypeORM/SP), reglas de negocio, catálogo de errores, seguridad y complejidad. Es AGNÓSTICO de dominio (module/entity los pone el usuario) e incluye snippets destilados del repo canónico. El agente DEBE leerlo ANTES de generar un servicio nuevo o refactorizar uno existente.',
  getRulesSchema,
  getRules
)
server.tool(
  'inspect_project',
  'Descubrimiento del proyecto destino (para el Flujo 2 refactor): detecta la convención de carpetas/case de dominios, la forma de la conexión TypeORM (forRoot por defecto vs conexiones nombradas, replication), la infraestructura transversal ya existente (JSON:API response, tipo de error, middleware, ConfigurationVariables) que debe REUSARSE, y los módulos presentes. Devuelve reglas a respetar antes de generar nada. Sobre el proyecto solo LEE; lo unico que puede escribir es la instalacion automatica del kit de agentes del MCP (.kiro/agents, agentic/templates y la seccion de AGENTS.md) la primera vez que se usa una herramienta en un repo, que es lo que el usuario pidio al configurar el MCP y se desactiva con MIDD_NESTJS_AUTO_KIT=off. Si lo instala, avisa que agente seleccionar.',
  inspectProjectSchema,
  withKit({ entry: true }, inspectProjectTool)
)
server.tool(
  'list_templates',
  'Lista las plantillas disponibles en el dataset (shared, config, _domain-slice).',
  listTemplatesSchema,
  listTemplates
)
server.tool(
  'get_template',
  'Devuelve el contenido crudo de una plantilla del dataset por su ruta relativa.',
  getTemplateSchema,
  getTemplate
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // Log a stderr (stdout está reservado para el protocolo MCP).
  console.error('midd-nestjs-hexagonal-architecture-mcp connected (stdio).')
}

main().catch((err) => {
  console.error('Error fatal en el servidor MCP:', err)
  process.exit(1)
})
