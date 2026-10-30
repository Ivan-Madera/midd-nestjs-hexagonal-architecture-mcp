# Diseño del MCP híbrido (NestJS hexagonal)

Este MCP junta dos proyectos que resolvían lo mismo con filosofías opuestas:

| | `midd-hexagonal-nestjs-mcp` | `lib-midd-mcp-architecture` |
|---|---|---|
| Idea | El servidor **genera** archivos (plantillas deterministas) | El servidor **guía** al agente (reglas, flujo y agentes servidos como texto) |
| Fortaleza | Resultado repetible, no depende del modelo | Experiencia amigable (preguntas), multi-stack, escáner de compliance |
| Debilidad | Hay que saber qué parámetros dar | La calidad depende del modelo |

**Principio del híbrido:** el agente decide y pregunta; el servidor ejecuta y verifica.
Lo estándar sale de plantillas (un modelo mediocre no puede romperlo) y lo que se desvíe lo atrapa
el verificador, que devuelve reglas con ID estable para que el agente corrija en bucle.

## Decisiones tomadas

| Tema | Decisión | Fuente |
|---|---|---|
| Estructura de carpetas | `core/domain/ports/inbound\|outbound`, `core/application`, `infrastructure/adapters`, `http-server` | Canon (`midd-pf-enrollment`) |
| Excepciones | `GenericException` en core, `CustomHttpException` en controller | Canon |
| Formato de código de error | `PREFIJO-SLUG-NNN`, NNN de 001 a 999 (p.ej. `ENROLLMENT-LOCKTYPENOTFOUND-011`) | Canon, con número de 3 dígitos |
| JSON:API | Se mantiene el canon: `try/catch` por controller con `ResponseJsonApiBase`/`CustomHttpException` (no `@JsonApiBody`) | Canon |
| Acceso a datos | TypeORM por defecto, Stored Procedure opt-in (mssql, postgres o mysql), cliente HTTP externo | Ambos |
| Idioma del código | Inglés (identificadores, comentarios, mensajes de plantillas nuevas) | Acordado |
| Ruta HTTP | `/{context}/api/v{N}/{resource}`; prefijo global = solo contexto; versión en cada controller | Librería |
| CORS | `CORS_ALLOWED_ORIGINS` vale `*` **por defecto** (Joi y `.env.example`), sin avisos; se cambia solo por variable de entorno. Lo demás de seguridad es obligatorio y bloqueante | Canon |
| Autorización | **Opt-in: el agente pregunta.** Secure-by-default y fail-closed cuando se activa | Librería |
| Dependencias prohibidas | `axios` (usar `fetch` nativo) y `uuid` (usar `randomUUID` de `node:crypto`) | Acordado |
| Capa agéntica | Un agente que se selecciona (`middleware-generator`) + dos sub-agentes internos (`middleware-gen-worker`, `middleware-auditor`) + sección en `AGENTS.md` + tool `install_agentic_kit`. Sin hook bloqueante ni YAML de fases | Acordado |
| Modelos de los agentes | Los del kit de `lib-midd-mcp-architecture`: orquestador `claude-sonnet-4.5`, worker `claude-haiku-4.5`, auditor `claude-opus-4.5`, con sus cadenas de respaldo terminadas en `Auto`. Sobrescribibles con el parámetro `models` | Acordado |
| `get_rules` | Se sirve completo, sin partir por secciones | Acordado |
| Health | Todo servicio nuevo trae `POST /{contexto}/api/v1/health` (liveness, `status: UP`). POST porque la política del área es POST-only; público aunque se active la autorización | Acordado |
| Aprendizaje | **Solo por repo** (`docs/mcp-learnings.json`), consultivo. El aprendizaje entre repos queda para después | Acordado |
| Alcance v1 | Solo NestJS. Interfaz de stack lista para sumar Java después | Acordado |

## Por qué cada regla

**Versión en el controller, no en el prefijo global.** La versión es por endpoint. Con
`setGlobalPrefix('svc/api/v1')` subir un solo endpoint a v2 obligaría a mover todo el servicio.
El prefijo global es solo el contexto y sale de `API_CONTEXT` (validada en Joi); un literal en `main.ts`
haría que cada servicio lo cambie a mano.

**CORS `*` por defecto, configurable por entorno.** El canon lo permite temporalmente (middleware
servidor-a-servidor) y así se mantiene: `CORS_ALLOWED_ORIGINS` tiene `*` como valor por defecto en el
schema Joi y en `.env.example`, sin ningún aviso en el log. Cuando se definan los dominios reales basta con
ponerlos en esa variable, sin tocar código. Lo único que se reporta (`CORS_WILDCARD`, WARN que no bloquea)
es un `'*'` escrito a mano en `main.ts`, porque impediría configurar orígenes reales. Detalle técnico: el paquete `cors` solo trata como comodín el *string* `'*'`; un `'*'`
dentro de un arreglo se compara como texto literal y nunca coincide, por eso `main.ts` lo detecta y pasa
`'*'` explícito. Un `enableCors()` vacío sí es un error.

**Cache-Control: no-store como primer middleware.** Helmet no lo pone, y un interceptor no vería los
rechazos de guards (401/403/429). Registrado primero, también lo llevan los errores.

**Correlation id independiente del llamador.** Si llega uno válido se reutiliza (encadena servicios);
si no, se genera con `randomUUID` de `node:crypto`. Se sanea contra `[A-Za-z0-9._-]{1,128}` porque un id
arbitrario permitiría falsificar líneas de log.

**Rate limiting con tres controles.** `@nestjs/throttler` solo cubre la tasa por IP (C1). La concurrencia
por IP (C2) y el tamaño de payload (C3) son controles distintos y los tres son obligatorios. C3 mira
`Content-Length` antes de parsear, para rechazar sin leer el body. `X-Forwarded-For` solo se respeta si
el peer directo es un proxy confiable (anti-spoofing). Los contadores viven en una caché acotada
(TTL por inactividad + tope de entradas) para que un atacante no pueda crecer la memoria.

**Rate limit antes que autorización.** Con dos guards globales, el de rate limit va primero para que una
avalancha se descarte sin gastar llamadas al autorizador. El verificador lo exige leyendo el arreglo
`imports` real de `AppModule` (ignora comentarios), porque el orden de los módulos es una propiedad de seguridad.

**Autorización opt-in, fail-closed.** Puerto agnóstico `IAuthorizationVerifier` + guard global. Todo
endpoint queda protegido salvo los marcados con `@SkipAuthorization()` (opt-out, nunca opt-in). Si el
autorizador deniega *o no responde*, el resultado es 403: no existe camino fail-open. Es opt-in porque
`AUTHORIZATION_API_URL` no debe ser obligatoria en un servicio que no la usa; el agente pregunta y
`add_authorization` parchea config, Joi, `.env.example` y `app.module` de forma idempotente.

**Sin `axios`.** Menos dependencias, menos superficie de CVEs. `consumoHttp` usa `fetch` nativo y mantiene el
contrato que ya consumen los adapters (`status`, `data`, `statusText`, `responseErrorApi`), sin lanzar
excepciones. Nunca asume que el body es JSON, tiene timeout (`AbortSignal.timeout`), reenvía el correlation
id y reporta el código real de red (`ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`).

**Sin `uuid`.** El paquete es solo ESM: compila pero revienta en runtime con `ERR_REQUIRE_ESM` en un build
CommonJS. `GeneratorUuidService` (antes `GeneratorUuuidService`) usa `randomUUID`. La regla prohíbe
declarar o importar el paquete; que aparezca como dependencia interna de `typeorm` o `mssql` es ajeno al
proyecto y no se puede evitar.

**Capa agéntica (y por qué no lleva hook ni YAML de fases).** Lo que el MCP de la librería resolvía con un
flujo rígido de fases y un hook que bloquea escrituras, aquí lo resuelven las plantillas y el verificador, que
no dependen del modelo. Quedó lo que aporta valor: (1) un agente que hace las preguntas, produce un
`middleware.spec.yaml` válido y orquesta, (2) un worker y un auditor tras bambalinas, y (3) una sección en
`AGENTS.md` que da a todos el mismo punto de entrada.
- **Pipeline multi-modelo, adaptado.** Igual que el kit de la librería: el orquestador lanza `subagent` en dos
  etapas (`complete` y luego `audit`), reintenta hasta 2 veces ante `FAIL`, pregunta al usuario ante
  `NEEDS-CONFIRMATION` y corre él mismo el BUILD GATE (los sub-agentes pueden no tener shell). **Una diferencia
  de fondo:** el worker NO escribe el hexágono a mano. Las plantillas ya lo generan de forma determinista y
  reescribirlo con un modelo barato degradaría justo lo que hace confiable al híbrido. El worker completa lo que
  el generador deja como andamiaje (guardas de reglas de negocio, consultas TypeORM, campos de entidades),
  solo desde el spec, y aplica el feedback exacto del auditor.
- **El auditor usa las herramientas del híbrido**, no un escáner aparte: `verify_standards` (todo error es
  `FAIL`), build + tests + lint reales, revisión de lo que una regex no juzga (regla de dependencia, SRP,
  fidelidad al spec), búsqueda de `TODO`/`NOTA`, `npm audit`, y cierra con `record_architecture`.
  Veredictos: `PASS`, `NEEDS-CONFIRMATION`, `PASS-PARCIAL`, `FAIL`. Un build que no corrió nunca es `PASS`.
- **Los tres se instalan y se actualizan como conjunto.** Si uno de los nombres ya existe de otro kit (el de la
  librería usa los mismos nombres), no se pisa y la herramienta avisa, porque mezclar instrucciones de dos MCP
  rompería el pipeline. Reemplazarlos es explícito (`overwrite=true`).
- **Los modelos se cambian con el parámetro `models`, no editando el `.md`:** volver a instalar reemplaza los
  archivos gestionados. El id se valida porque se escribe dentro del YAML del agente.
- **Una sola fuente del procedimiento.** El paso a paso vive en `prompts.ts` y se sirve con `get_flow`; el
  agente instalado lo consulta en vez de copiarlo, así no hay dos versiones que se desincronicen.
- **El agente enseña exactamente lo que acepta el parser.** Usa los nombres literales de `validateSpec`
  (`error_prefix`, `resource_type`, `connection.name`, `none: true`...). Un test lo exige.
- **No pisa lo del equipo.** Solo es nuestro el bloque entre los marcadores BEGIN/END de `AGENTS.md`
  (el resto se conserva byte a byte, también con CRLF). Un archivo con el mismo nombre que no instaló este
  MCP se respeta salvo `overwrite=true`. Marcadores desbalanceados no se tocan.
- **Versionado y reinstalable.** Cada archivo lleva la versión del MCP; `install_agentic_kit` es idempotente
  y actualiza los instalados.
- **Consumo de créditos (según kiro.dev; revísalo, cambia seguido).** Familia 4.5, la de los defaults:
  Haiku 0.4x, Sonnet 1.3x, Opus 2.2x. Familia 5.5: Haiku 0.06x, Sonnet 1.3x, Opus 2x. El worker ya es el más
  barato; si la empresa limita tokens, el candidato a bajar es el auditor (Opus a Sonnet, que ya es su
  respaldo), sabiendo que es la red de seguridad del pipeline. Se cambia con `models: { auditor: ... }`.

**Health de liveness en cada servicio nuevo.** `scaffold_service` deja `POST /{contexto}/api/v1/health` con las mismas
reglas que cualquier endpoint (POST-only, `vnd.api+json`, sobre JSON:API, versión en el controller). Responde 200 con
`{ status: "UP" }` en cuanto el borde HTTP está arriba y no revisa nada más: ni la BD (fallaría por razones ajenas a que el
proceso esté vivo) ni versión ni host (no filtra datos). Es POST, no GET, porque el verificador bloquea cualquier verbo
distinto y el kit de la librería usa también un POST como ejemplo de endpoint público.
- **Sigue público con autorización.** `add_authorization` lo marca `@SkipAuthorization()` (idempotente; si el servicio no
  tiene health, como en un refactor, no inventa uno) y el verificador exige la marca (`HEALTH_NOT_PUBLIC`): sin ella el
  guard respondería 401 y el health dejaría de servir para validar el arranque.
- **Las comprobaciones de archivo completo ignoran comentarios.** El primer borrador del health mencionaba
  `@SkipAuthorization()` en su comentario, y tanto el parche como la regla lo daban por hecho: ni parcheaba ni detectaba. Lo
  encontraron las pruebas; ahora ambos deciden sobre el código, no sobre el texto de un comentario.

**Prueba end-to-end real (`npm run test:e2e`).** Fuera de `npm test` a propósito: la primera vez necesita red y tarda
unos minutos; las dependencias quedan en caché en la carpeta temporal y solo se reinstalan si cambia el `package.json`
generado. Genera dos módulos (uno con stored procedures y otro con TypeORM) más autorización, y ejecuta los scripts del
propio servicio (`npm run build`, `npm test`, `npm run lint:check`) además de `verify-standards`. Después lo arranca con
exactamente los valores de su `.env.example` (si faltara una variable obligatoria, no arranca) y le pega por HTTP.
- **Límite honesto:** no hay una base de datos viva en la prueba, así que se arranca el `main.ts` real con un módulo de borde que importa
  los módulos reales de seguridad, health y autorización pero no la base de datos. Lo que toca la BD queda cubierto por la
  compilación, los tests unitarios del servicio y el verificador, no por una conexión viva.
- **Defecto real que encontró:** un cuerpo mayor al límite enviado por partes (sin `Content-Length`) lo rechazaba el parser de
  Express con 413, pero con el cuerpo `PF-ERROR-GENERIC` / "Internal Server Error", porque el filtro global no reconocía errores
  del parser. Igual un JSON malformado (400). Ahora ambos responden con el sobre del área (`SERVICE-PAYLOADTOOLARGE-019`,
  `SERVICE-BADREQUEST-016`) y `meta.correlationId`.

**Multi-motor de base de datos (mssql, postgres, mysql).** El agente pregunta el motor cuando la API es nueva y de la
respuesta salen el driver, las opciones de TypeORM (módulo `<motor>.database.<conexion>.module.ts` y archivo de opciones)
y el dialecto del stored procedure (mssql `EXEC`, mysql `CALL`; en PostgreSQL el área no los usa). El motor es
obligatorio y nunca se asume: `motor` en `scaffold_service`, `connection.engine` en el spec, y en `add_use_case` solo
cuando la conexión es nueva. Un motor distinto al de una conexión existente se rechaza; el modo refactor nunca crea
conexiones. Variables por conexión: `DB_<NOMBRE>_HOST/PORT/USERNAME/PASSWORD/NAME`, donde `<NOMBRE>` es el nombre de la
conexión, que sale del motor (`DB_MSSQL_HOST`, `DB_MSSQL2_HOST`). Confirmado con el equipo; se aparta del canon `MSSQL_DATABASE_*` para poder tener varias conexiones.
- **El nombre de la conexión no se pregunta.** Sale del motor: `Mssql`, `Postgres`, `Mysql` (variables `DB_MSSQL_*`). Si el motor ya
  tiene una sola conexión, se reutiliza; si no hay, se crea; si hay varias del mismo motor y no se dice cuál, se rechaza con la lista.
  Una conexión ADICIONAL del mismo motor se numera (`Mssql2`, `Mssql3`): un sufijo con guion no sirve en nombres de clase ni de
  variable. Solo la crea el usuario al pedirla; el agente escribe ese nombre en `connection.name` del spec (inspect_project lo indica).
  `conexion` solo se pasa para una conexión adicional. **Refactor:** el proyecto ya tiene su conexión, así que se detecta y se
  reutiliza (`inspect_project`: una nombrada, o la `forRoot` por defecto); nunca se pregunta su nombre ni su motor y nunca se crea
  nada (ni módulo, ni variables). Solo si el proyecto tiene varias nombradas se debe indicar cuál usa el caso.
- **"Sin base de datos".** Si en una API nueva el usuario responde que no usa base de datos (`motor: none`), no se genera ninguna
  conexión: ni módulo de BD, ni variables `DB_*`, ni driver. El servicio compila y arranca (lo prueba el e2e con el `main.ts` real). Los adapters
  TypeORM y SP se rechazan hasta que se indique un motor; hoy no hay otro tipo de adapter, así que un servicio sin base de datos es solo
  la base hasta que exista uno (por ejemplo, de API externa).
- **Adapter de API externa (`adapter: http`).** Es lo habitual cuando el servicio no usa base de datos. El caso consume una API con el
  fetch nativo (`consumoHttp`, sin axios) y no necesita conexión ni motor; si todos los casos del spec son de API externa, ni siquiera se
  pregunta el motor. En el spec: `api` (PascalCase) a nivel de caso y `http: { method, path }` por método. La URL base vive en
  `<API>_BASE_URL` (por ejemplo `EXCHANGE_RATES_BASE_URL`): `ConfigurationVariables.externalApis`, Joi `.uri().required()` (sin ella el
  servicio no arranca) y la sección `External APIs` del `.env.example`; la comparten todos los casos contra la misma API. GET envía la
  request como query string y POST/PUT como cuerpo JSON. Un 404 de la API es `null` (el application service decide); no alcanzarla, un
  timeout o cualquier otro error HTTP lanza `EXTERNAL_API_ERROR` del catálogo del dominio (502, código `<PREFIJO>-EXTERNALAPI-<NNN>`).
  El e2e levanta una API falsa real y comprueba 200, 404, 502, API caída y que el `x-correlation-id` viaje a la API.
- **Límites del adapter http:** sin autenticación generada (queda un TODO en el adapter y el agente lo avisa; las credenciales deben salir de
  `ConfigurationVariables`), sin parámetros dentro de la ruta (`/items/{id}`): los datos van por query string o cuerpo, y la respuesta se mapea
  como un solo objeto (si la API devuelve otra forma hay que ajustar el mapeo).
- **Defecto corregido de paso:** si el primer caso de un dominio no usaba TypeORM (SP o API externa), su cableado quitaba el import de
  `TypeOrmModule`; un caso TypeORM posterior lo usaba sin importarlo y el servicio no compilaba. El merge ahora lo vuelve a importar.
- **Códigos de error de 3 dígitos, en secuencia.** El formato es `<PREFIJO>-<SLUG>-<NNN>` con NNN de 001 a 999. Antes el canon y el MCP usaban
  4 dígitos y cada caso nacía con `0001`, sin secuencia: dos casos con la misma entidad repetían código. Ahora cada error que crea el MCP
  (el de aplicación y el de dominio de un caso, los de reglas de negocio y el de API externa) toma el siguiente número libre del prefijo,
  leído del propio código (comentarios incluidos), sin contador aparte. Se migraron los códigos de la capa compartida (`SERVICE-...-013` a `021`).
  Un caso nuevo en un dominio que ya existe agrega sus entradas a los catálogos; antes quedaban sin la llave y el servicio no compilaba.
  El verificador falla con `ERROR_CODE_DUPLICATE` y avisa con `ERROR_CODE_FORMAT`. Si un prefijo agota el 999, el MCP lo dice y pide otro prefijo.
  Los servicios generados antes conservan sus códigos de 4 dígitos; cuentan por su valor para no chocar con los nuevos.
- **Instalación automática del kit de agentes.** Un servidor MCP se configura una vez para todo el usuario, así que al arrancar no sabe qué repo
  está abierto; lo sabe cuando una herramienta recibe `projectRoot`. Ahí (`scaffold_service`, `add_use_case`, `generate_from_spec`,
  `add_authorization`, `inspect_project`) se revisa el kit y, si falta, se instala antes de ejecutar la herramienta. La revisión va primero: si ya
  está a la versión actual no se escribe nada; un agente ajeno con el mismo nombre no se reemplaza ni se mezcla (no se instala medio kit); y al
  actualizar se conservan los modelos que el equipo puso en los agentes. Una carpeta inexistente solo se crea con `scaffold_service`. Se
  desactiva con `MIDD_NESTJS_AUTO_KIT=off`. La respuesta de la herramienta agrega un aviso para el usuario y para el agente. Las herramientas que
  solo leen o verifican nunca instalan.
- **Lo que un MCP no puede hacer, y lo que no verifiqué.** Cambiar el agente del chat: en Kiro IDE se elige en el selector de la barra del chat
  (hay un agente preferido que persiste, según el changelog 1.0) y no encontré un archivo documentado que lo fije por código. Tampoco pude
  confirmar que los agentes instalados aparezcan en el selector: la documentación de Kiro dice que los perfiles con `allowedTools` o
  `toolsSettings` sin bloque `permissions` se omiten en CLI V3 hasta migrarlos con `/upgrade-agent`, y que en el IDE los perfiles existentes siguen
  funcionando. Los agentes del kit usan esos campos (heredados del kit de la librería). Si tras la instalación `middleware-generator` no
  aparece en el selector, el primer sospechoso es ese formato.
- **El entorno lo prepara el agente.** Las notas de las herramientas están dirigidas al agente ("AGENTE: ..."): corre `npm install`, crea el `.env`
  a partir del `.env.example` con los valores que le da el usuario y no repite contraseñas. El MCP genera un `.gitignore` (nunca pisa el del proyecto)
  y `ENV_NOT_IGNORED` falla si existe un `.env` que git no ignora.
- **Sin stored procedures en PostgreSQL (decisión del área).** `add_use_case` y `generate_from_spec` rechazan `adapterType: sp` sobre una conexión postgres, antes de escribir nada. El dialecto de Postgres quedó en el código pero ya no es alcanzable por las herramientas.
- **Textos de error generados desde la entidad, en español.** Antes cada catálogo de error nacía con texto de plantilla ("Título legible del
  error.") que nadie revisaba y llegaba tal cual a quien consume la API. Ahora el MCP escribe `message`, `title` y `suggestedActions` a partir de
  la entidad (`LockType` -> "Lock type no encontrado.", "No se encontró lock type con los parámetros enviados."), también cuando un caso se
  suma a un dominio que ya existe y para el error de API externa. Es una suposición razonable: la persona la corrige si no se apega al caso (el
  género y la redacción pueden no encajar). El verificador avisa con `ERROR_CATALOG_PLACEHOLDER` si un catálogo conserva el texto de plantilla
  (servicios generados antes).
- **Cuántas preguntas hace el agente.** En una API nueva, tres momentos: (1) **un solo mensaje con lo general de la API**: prefijo de la API,
  prefijo de errores, base de datos (mssql, postgres, mysql o ninguna), autorización, Postman y `ARCHITECTURE.md`; (2) **por caso de uso**:
  "qué hace, qué recibe y qué devuelve", y de ahí el agente **deduce** si los datos salen de la base de datos (TypeORM), de una API externa o
  de un stored procedure; solo pregunta el dato que falta de ESE caso (nombre, verbo y ruta de la API; nombre del SP); (3) los valores reales
  del entorno, al preparar el servicio. No se pregunta: la conexión, los números de error, CORS, los límites de peticiones, el health, las
  rutas, la complejidad (nivel 0 por defecto), las reglas de negocio que el usuario no mencionó (`none: true`) ni el esquema (queda como TODO).
  Con "ninguna" base de datos, todos los casos son de API externa. Lo que se supone se lista como TODO al final. **No observado:** cuántas
  preguntas hace de verdad con modelos reales; falta la primera prueba dentro de Kiro.
- **Refactor sin conexión.** Si el proyecto no tiene ninguna, el MCP no la genera. Solo si el usuario la pide expresamente
  (`crearConexion=true`, o `connection.create: true` en el spec) se pregunta el motor y se crea completa, nombrada por el motor; pasar
  solo el motor no basta, para que un reflejo del agente no cree nada. El caso se avisa en el reporte porque el `app.module` es del proyecto.
- **Tres huecos cerrados.** (1) Una segunda conexión nombrada se crea completa (módulo, opciones, variables, Joi,
  `.env.example`, registro en `app.module`); antes solo se referenciaba y el servicio no arrancaba. (2) Las entidades se
  cargan con `autoLoadEntities: true` en lugar de `entities: []`. (3) El adapter SP inyecta el servicio de SU conexión;
  antes usaba el token genérico (la primera conexión) y ejecutaba el SP en la base equivocada sin error.
- **Defecto de producción corregido.** El driver `mssql` iba en `devDependencies` y el Dockerfile instala con
  `--omit=dev`: la imagen no tenía el driver. Ahora el driver va en `dependencies` (el e2e lo comprueba).
- **Reglas del verificador nuevas:** `DB_CONNECTION_MISSING` y `MISSING_ENV_VALIDATION` generalizada (todo
  `process.env.X` de ConfigurationVariables debe estar en Joi).
- **Se mantiene del canon (observaciones de seguridad, no cambiadas):** `trustServerCertificate: true` en mssql y
  `logging: ['query']`.
- **Límites honestos:** no se probó contra motores vivos. Los dialectos de postgres y mysql se prueban con un DataSource
  falso (33 tests en `test/database.test.mjs`). En PostgreSQL no se usan stored procedures: el MCP rechaza `adapter: sp` sobre esa conexión.

**Documentación de la API generada desde el código.** `generate_api_docs` lee los controllers, los DTOs y los catálogos
de error del servicio y escribe, por módulo, el contrato `src/<modulo>/contracts/<modulo>.api.md` y un diagrama Mermaid
`sequenceDiagram` en `src/<modulo>/diagrams/<modulo>.flow.mmd`, más el índice `docs/api/README.md`. Es determinista (mismo
código, mismos archivos; la segunda corrida no reescribe nada) y no depende de que el modelo se acuerde.
- **Se mantiene al día solo:** `add_use_case`, `generate_from_spec` (al final, porque los DTOs se rellenan después de sembrar
  cada caso) y `record_architecture` regeneran el contrato y el diagrama del módulo. Un fallo de documentación nunca rompe una generación.
- **Opt-in, el agente pregunta:** la colección de Postman (una para todo el servicio, una carpeta por módulo; al fusionar solo se
  reemplaza la carpeta del módulo y se respetan las ajenas) y `docs/ARCHITECTURE.md` con `architecture-beta`. Una vez creados, se refrescan solos.
- **Por qué sequenceDiagram + architecture-beta:** el de secuencia es el tipo estable para el flujo de una petición. `architecture-beta`
  (Mermaid 11.1+) sirve para la vista general; sus líneas `align` requieren 11.16+ y solo se emiten con 2 o más módulos. El C4 de
  Mermaid sigue siendo experimental y no se usa. Los tres diagramas generados se validaron con el parser de Mermaid 12.2.
- **Verificador:** `API_DOCS_MISSING` y `API_DOCS_STALE` (WARN, no bloquean) cuando falta el contrato o el diagrama, o el contrato no lista un endpoint del código.
- **Límites:** los campos salen de las clases del código (DTO y entidad de dominio). Los títulos de error son los del catálogo
  generado, que arranca con texto de plantilla hasta que alguien lo edita; el contrato lo refleja tal cual. En un proyecto refactorizado
  con otra estructura, los campos que no se puedan leer se marcan en el documento en lugar de inventarse.

**Aprendizaje por repo, sin cuestionar las reglas base.** El MCP recuerda entre sesiones del mismo repo lo que
sirve para proponer mejor y para no repetir errores. La captura es determinista (no depende de un modelo):
`scaffold_service` y `add_use_case` guardan el contexto del servicio, los prefijos de error y las conexiones;
`add_authorization` y `record_decision` guardan la decisión de autorización; `verify_standards` guarda qué reglas
fallan. El agente lo consulta con `get_learnings`, justo después de `get_rules`.
- **Consultivo por construcción.** El verificador, el generador y las plantillas no leen el archivo (un test lo
  exige) y otro prueba que el verificador da exactamente el mismo resultado con una memoria hostil o sin memoria.
- **Sin texto libre.** Cada campo tiene forma cerrada y una sola función de saneamiento sirve a la lectura y a la
  escritura: un archivo editado a mano con instrucciones nunca llega al agente. Sobre un error, el agente lee un
  texto fijo del MCP indexado por el ID de la regla (31 reglas; un test exige uno por cada regla del verificador
  y que ninguno diga "ignora", "desactiva", etc.).
- **Lo que NO se aprende, a propósito:** que el repo "usa stored procedures". El SP es opt-in y se pregunta
  siempre; un default aprendido contradiría una regla base.
- **Una violación cuenta una vez por aparición**, no por intento: si sobrevive varias vueltas del bucle de
  corrección sigue siendo una; si se arregla y vuelve, es otra. Se muestra desde la segunda.
- **Sin ruido en git.** Claves ordenadas, y si el conocimiento no cambió no se reescribe ni se toca el archivo.
  Un archivo ilegible se respeta tal cual (puede tener ediciones a mano) y no rompe la herramienta que lo dispara.
- **Qué mejora y qué no.** Mejora el contexto que recibe el agente y cuánto pregunta; el modelo sigue siendo el
  mismo, y con pocos módulos hay poca señal. Corregir una plantilla a partir de un error frecuente sigue siendo
  una decisión humana (esa es la parte entre repos, aún sin construir).

**Credenciales fuera de los logs.** El `consumoHttp` del canon logueaba las cabeceras completas de un error,
incluido `Authorization`. Ahora se redactan, y tampoco se loguea el body ni la query del request.

**Límite explícito en el body parser.** Express usa 100 kb por defecto, por debajo de la política de 2 MB.

## Verificación (qué se probó)

- `npm test` (50 tests): unitarios del MCP, más un e2e que genera un servicio completo, exige que
  `verify-standards` pase y comprueba que detecta cada violación introducida a propósito (seguridad, ruta,
  dependencias prohibidas, autorización, `HTTP_IN_CORE`, `ENV_DIRECT`, etc.). También prueba que CORS
  arranca en `*` sin avisos, que un `'*'` escrito a mano solo advierte, que el reporte del verificador es
  ASCII puro y que `add_authorization` es idempotente y opcional.
- Un servicio generado compila (`tsc`, `nest build`), pasa sus tests y ESLint, con y sin autorización.
  No instala `axios`.
- Se arrancó el `main.ts` generado y se verificó por HTTP: URL `/{context}/api/v1/...`, cabeceras,
  correlation id (generado, reutilizado y saneado), 415, 406, 404, 413, 429 con `Retry-After: 5`, CORS
  (origen permitido, malicioso y comodín) y que cada línea de log lleva el correlation id.
- Autorización contra un autorizador falso: 401 sin token, 200 con token válido, 403 con inválido,
  fail-closed con el autorizador caído (403), endpoint público sigue en 200, el token y el correlation id
  se reenvían, y de 8 peticiones solo 5 llegan al autorizador (el rate limit descarta el resto antes).
- `consumoHttp` contra un servidor local: éxito, body JSON/HTML/vacío, 500 y 502, timeout, conexión
  rechazada y DNS inexistente, correlation id reenviado y token ausente de los logs.
- El guard de concurrencia (C2), su liberación única y el anti-spoofing se probaron contra el código
  compilado, no por HTTP.
- Capa agéntica: 14 tests del instalador (idempotencia, `AGENTS.md` ajeno/CRLF/roto, archivo ajeno,
  versión vieja) y, por el protocolo MCP real con un cliente stdio, que toda tool que nombran el agente y
  `AGENTS.md` existe de verdad.
- Recorrido completo del agente simulado en un proyecto real (instalar kit, escribir el spec, `dryRun`,
  generar con SP y reglas, autorización): compila, `nest build`, sus tests propios pasan (2 de 2), ESLint y
  `verify_standards` sin errores. **Esa corrida encontró dos defectos del generador original**, ya
  corregidos y cubiertos por tests:
  1. Los stored procedures de los métodos adicionales de un caso no se declaraban en
     `ConfigurationVariables`, Joi ni `.env.example`: el adapter usaba `storedProcedures.X` y no compilaba
     (`verify_standards` sí lo detectaba como `SP_NOT_DECLARED`). Confirmado contra el generador original.
  2. El test que genera la plantilla usaba un dato de ejemplo ajeno al spec y la regla de negocio generada lo
     rechazaba: un servicio recién generado nacía con un test en rojo, y el test de error pasaba por la razón
     equivocada. Ahora el dato se construye desde `dtos.input`.

## Pendiente (próximas fases)

1. **Probar el pipeline con modelos reales en Kiro.** Los tres agentes están escritos y su contrato con el MCP
   está probado (frontmatter, tools que nombran, nombres de sub-agentes consistentes, `models`), pero **nadie ha
   ejecutado el pipeline `subagent`**: no se sabe qué tan bien sigue las fases el orquestador, si el worker de
   Haiku completa bien las guardas sin inventar, ni si el auditor encuentra lo que debe. Tampoco se verificó que
   Kiro respete las cadenas de respaldo escritas en el texto (un agente no puede cambiar su propio modelo).
   Es la mayor incógnita; conviene correrlo con un caso real y ajustar el texto.
2. **Aviso obligatorio de TODOs:** ahora lo hace cumplir el auditor (busca `TODO` y `NOTA (agente/usuario)` y los
   manda a `NEEDS-CONFIRMATION`), pero depende de un modelo. Hacerlo determinista: que `verify_standards`
   emita un aviso `PENDING_TODO` por cada marca, o que `record_architecture` las liste.
2b. **Reglas de negocio por caso:** hoy se aplican al primer caso del spec (el generador original ya lo
   avisa en una nota); habría que poder asociarlas a un caso concreto.
2c. **Aprendizaje entre repos:** hoy cada repo aprende solo de sí mismo. Siguiente paso: una herramienta de
   retrospectiva que lea las auditorías y `mcp-learnings.json` de varios repos y reporte qué reglas fallan más
   (solo IDs y conteos, sin nombres), para que una persona corrija plantillas y la mejora llegue por versión.
   Los avisos de errores frecuentes también están solo en inglés mientras el resto del texto del MCP está en español.
3. **Limpieza de nombres en inglés** en la capa `shared` heredada (`consumoHttp`, `IconsumoHttp`,
   `ErrorEventManagement`, `database-context`) y los mensajes en español de las plantillas del canon.
4. **Modernizar dependencias** de la plantilla: `eslint ^8` (deprecado), `@types/node ^20`,
   `reflect-metadata` distinto entre `package.base.json` y `package.snippet.json`; `engines.node >= 22`.
5. **Compliance extra:** `API_DOC_*` (contrato `.api.md` y Postman) y reglas de dinero con `decimal.js`
   cuando el módulo maneje montos.
6. **Logs de autorización:** una denegación normal (token inválido) hoy se registra como `ERROR` desde
   `consumoHttp`; conviene bajarla a `WARN` para no ensuciar el log.
7. **Stack Java (Spring Boot):** reutilizar el flujo, el spec y el verificador; solo cambian plantillas y reglas.
