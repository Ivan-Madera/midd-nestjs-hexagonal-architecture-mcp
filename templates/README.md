# Dataset: plantillas canónicas de `middleware-hexagonal-nestjs`

Este directorio es el **dataset** que acompaña a la skill
`.kiro/steering/middleware-hexagonal-nestjs.md`. Contiene los archivos reales que un servicio del
área debe tener **idénticos**, para que la skill los **copie tal cual** en vez de regenerarlos.

## Regla de oro

- Los archivos bajo `shared/` y `config/` son **copia byte-por-byte**. NO los regeneres leyendo prosa:
  cópialos literalmente. Regenerarlos introduce variaciones sutiles y desperdicia trabajo.
- Los archivos bajo `_domain-slice/` son **plantillas con placeholders** (`__Caso__`, `__caso__`,
  `__CASO__`, `__Dominio__`, `__dominio__`, `__Entidad__`, etc., y `<Conexion>`, `<PREFIJO>` en el
  contenido): cópialos, renómbralos y sustituye (ver tabla de marcadores más abajo).
  La sustitución DEBE ser **case-sensitive**: `__Caso__`, `__caso__` y `__CASO__` son distintos.
- Al copiar `shared/`, ajusta el nombre de carpeta raíz del servicio si aplica, pero NO cambies el
  contenido salvo lo estrictamente parametrizable (p.ej. nombres de conexión a BD).
- Todo cumple el formato Prettier del área (comillas simples, sin `;`, sin trailing comma, 2 espacios)
  y las cabeceras de seguridad obligatorias. No bajes esos estándares al adaptar.

## Qué va aquí vs qué decide la skill

| Contenido | Dónde | Tratamiento |
|---|---|---|
| Capa `shared` (JSON:API, errores, logger, config, db-context, utils) | `shared/` | copiar idéntico |
| Enforcement y config (eslint, prettier, verify, hooks, Dockerfile) | `config/` | copiar idéntico |
| Vertical slice de un caso de uso | `_domain-slice/` | copiar + sustituir placeholders |
| Criterio: refactor, naming, decisiones, antipatrones | la skill `.md` | juicio del modelo |

## Fuente

Derivado del servicio canónico del área (`midd-pf-enrollment`), con el naming ya corregido
(`http-server`, no `htttp-server`) y el formato normalizado a Prettier. Si el estándar evoluciona, se
actualiza aquí (fuente única) y todos los servicios nuevos heredan el cambio.

## Marcadores de sustitución (solo para `_domain-slice/`)

**Dos formas del mismo marcador según dónde aparezca:**
- **En nombres de archivo/carpeta:** `__X__` (doble guion bajo), porque `<>` son inválidos en Windows.
  Ej.: `__caso__.application.ts`, `I__Caso__Service.ts`, `__dominio__.core.module.ts`.
- **Dentro del contenido:** `__X__` para identificadores de código (clases, variables, imports) y
  `<X>` para texto/valores no-identificador (rutas, nombres de tabla, SP, prefijos). Ej.: la clase
  `__Caso__ApplicationService` pero `@Controller('/<ruta-dominio>')` y `'<PREFIJO>-<SLUG>-<NNN>'`.

Al materializar: **renombra los archivos** sustituyendo `__X__` y **reemplaza en el contenido** ambas
formas. Después aplica Prettier y corre el build.

| Placeholder | Significado | Ejemplo |
|---|---|---|
| `__Dominio__` / `__dominio__` | bounded context en Pascal / camel | `Enrollment` / `enrollment` |
| `__Caso__` / `__caso__` | caso de uso en Pascal / camel | `ImeiValidation` / `imeiValidation` |
| `__CASO__` | caso de uso en MAYÚSCULAS (tokens DI) | `IMEI_VALIDATION` |
| `__Entidad__` | entidad de dominio | `LockType` |
| `__Attributes__` | clase de attributes del DTO | `ImeiDataToValidate` |
| `__Respuesta__` | tipo de retorno del caso de uso | `LockTypeResponse` |
| `__metodo__` / `__param__` | método del puerto / su parámetro | `retrieveLockType` / `imei` |
| `__casoDeUso__` / `__accion__` | método del application / ruta POST | `imeiValidation` / `checkLockType` |
| `__ERROR_KEY__` / `__NombreSp__` | llave del catálogo / nombre SP en config | `NOT_FOUND_0048` / `GetLockTypePhone` |
| `<Conexion>` | nombre de conexión TypeORM | `SoftCredito` |
| `<PREFIJO>` / `<SLUG>` | prefijo y slug de códigos de error | `ENROLLMENT` / `NOTFOUND` |
| `<ERR_NUM_APP>` / `<ERR_NUM_DOM>` | número (001-999) del error de aplicación / de dominio; lo asigna la secuencia del prefijo | `001` / `002` |
| `__ApiExterna__` / `__ENV_VAR_API__` | adapter `http`: nombre de la API externa / variable de su URL base | `ExchangeRates` / `EXCHANGE_RATES_BASE_URL` |
| `__HTTP_CALL__` | adapter `http`: la llamada completa (`get(this.url('/rates'), { params: ... })`, `post(...)`) | `get(this.url('/rates'), ...)` |
| `<ruta-dominio>` / `<tipo-recurso>` | path kebab-case / type JSON:API | `enrollment-pfm` / `lock-type` |
| `<nombre_tabla>` / `<columna>` | mapeo TypeORM | `sfc_ventas` / `vs_imei` |

## Elección de adapter en `_domain-slice/` (TypeORM por defecto; SP es OPT-IN explícito)

El acceso a datos por defecto es **TypeORM**. El stored procedure NO se asume: el desarrollador debe
**pedirlo explícitamente e indicar el nombre del SP**. Vienen tres adapters; usa UNO y borra los otros:
- `__caso__.typeorm.adapter.ts` — repositorio TypeORM de entidad (**por defecto**, probado end-to-end).
- `__caso__.sp.adapter.ts` — stored procedure vía `DatabaseCommonService` (**solo si el dev lo pide**).
- `__caso__.http.adapter.ts` — API externa con el `fetch` nativo (`consumoHttp`); **no usa base de datos** (solo si el caso consume una API).

Por defecto, `infrastructure.__dominio__.module.ts` y `__dominio__.module.ts` importan el `.typeorm`;
borra el `.sp`.

**Si el dev pide stored procedure** (debe dar el nombre del SP):
1. Cambia el import al `.sp.adapter` en **ambos** módulos (`infrastructure.__dominio__.module.ts` y
   `__dominio__.module.ts`) y borra el `.typeorm`.
2. Registra el nombre del SP en `shared/infrastructure/config/ConfigurationVariables.ts`
   (`storedProcedures`), en `joiSchema.ts` (como `required()`) y en `.env.example`.
3. Nunca hardcodees el nombre del SP ni leas `process.env` fuera de `ConfigurationVariables`.

## Estado del dataset

- [x] `shared/` — contratos JSON:API, error management, logger, config, database-context, utils
- [x] `config/` — eslint, prettier, Dockerfile, dockerignore, verify-standards, hooks husky, main.ts
- [x] `_domain-slice/` — vertical slice completa de un caso de uso con placeholders
