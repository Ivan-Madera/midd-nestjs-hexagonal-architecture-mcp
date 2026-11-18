# Estandares base (agnosticos)

Referencia para repos `estandar`, proyectos nuevos y deteccion de brechas en `legacy`. Si el proyecto contradice alguno, manda el proyecto. Los numeros son referencia; confirmalos si importan.

## Arquitectura
- Hexagonal: el dominio no conoce la infraestructura; dependes de puertos (interfaces), el cableado concreto vive en modulos/config.
- Un puerto no expone detalles de infraestructura (nombre de SP, URL, tabla).
- Reglas de negocio como guardas en la capa de aplicacion, no en DTOs ni adapters.
- Entidades de dominio puras; las de persistencia son distintas.

## Naming y mapeo
- Codigo en ingles; textos de error al usuario en el idioma del negocio.
- TS: kebab-case con sufijo de tipo (`retrieve-product.controller.ts`). Java: convencion de paquetes. Clases PascalCase; metodos y campos camelCase.
- Mapea fuentes de datos de forma explicita; nunca cast ciego de una fila.

## Contrato HTTP
- JSON:API: request `{ data: { attributes } }`; response `data { type, attributes }` + `links`. `Content-Type: application/vnd.api+json` obligatorio (415 si no).
- URL `/{contexto}/api/v{N}/{recurso}`: contexto desde config (nunca literal), version por endpoint (no en el prefijo global), primera version `1`.
- Verbos: los que defina el proyecto. Si la politica del area es solo POST, todo viaja como POST; confirmalo antes de asumirlo.
- Health de liveness publico, sin consultar dependencias.
- El controller envuelve el handler en try/catch y relanza excepcion HTTP preservando code/title/status/suggestedActions.

## Errores
- Catalogo con `code` (`<PREFIJO>-<SLUG>-<NNN>`, NNN 001-999, secuencia por prefijo, sin repetir), `title`, `status`, `suggestedActions`.
- Errores de dominio separados de los de aplicacion.

## Seguridad
- Cabeceras en toda respuesta: HSTS (1 ano), CSP, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy, `Cache-Control: no-store` (primero, para que lo lleven tambien 401/403/413/429).
- CORS explicito desde config; nunca origen literal ni habilitado vacio.
- Rate limiting, los tres controles: tasa por IP (150 req/5 s, 429 + Retry-After), concurrencia por IP (20, 429), tamano de payload por Content-Length antes de parsear (8 MB general, 2 MB JSON, 413). IP real solo via proxy confiable; contadores en cache acotada (TTL y tope).
- Orden del borde: no-store -> correlation id -> limite de payload -> cabeceras + CORS -> body parser con limite -> filtro global de excepciones y validacion -> guards (rate limit primero, autorizacion despues).
- Autorizacion: pregunta si el servicio la exige. Si si: secure-by-default, opt-out explicito solo en endpoints publicos (health, webhooks); 401 sin token, 403 denegado; la logica HTTP vive en un adapter detras de un puerto, no en el guard.
- Correlation id en cada log; nunca loguees credenciales; sin `console.*` / `System.out`.
- Config centralizada y validada al arranque; nada lee variables de entorno fuera de la capa de config. `.env.example` sincronizado con el schema, solo placeholders.

## Datos
- ORM/repositorio por defecto; stored procedures solo si se piden. El motor de BD se pregunta; la conexion existente se reutiliza y no se crea una sin que la pidan.
- API externa: cliente HTTP del proyecto, URL y credenciales desde config, 404 como "no existe", otros fallos como error del catalogo (502).
