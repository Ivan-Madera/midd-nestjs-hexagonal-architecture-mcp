---
name: midd-generate-readme-ts
description: Genera un README de nivel enterprise para backends TypeScript como NestJS Express o Fastify a partir de un analisis profundo del codigo real detectando arquitectura endpoints DTOs variables de entorno tests y DevOps y produce documentacion en espanol con diagramas Mermaid y tablas. Usala cuando el usuario pida documentar un backend TypeScript, generar un README profesional o enterprise, documentar la API, o mencione readme pro, documenta el backend o documentacion completa del proyecto.
---

# README profesional para backends TypeScript

Genera un **README.md de nivel enterprise** para un backend TypeScript, basado en el analisis real del codigo: arquitectura, endpoints, DTOs, diagramas Mermaid y documentacion de produccion.

El objetivo es documentacion de primer nivel, **siempre anclada a lo que existe de verdad en el repo** (nada inventado).

## Cuando usar esta skill

- Cuando el usuario pida documentar un backend TypeScript (NestJS, Express, Fastify, etc.).
- Cuando quiera un README enterprise con analisis arquitectonico.
- Cuando necesite documentar automaticamente la API a partir del codigo.
- Cuando un equipo necesite documentacion con diagramas e insights de ingenieria.

## Herramientas de Kiro a usar para el analisis

No hay un parser AST externo: realiza el analisis con las herramientas del propio Kiro.

- **list_directory / file_search**: mapear la estructura del proyecto y ubicar carpetas clave (`src`, modulos, controllers, services, dto).
- **read_file / read_code**: leer `package.json`, controllers, services, modulos, DTOs y archivos de configuracion. Usa `read_code` para extraer firmas de clases y metodos en archivos grandes.
- **grep_search**: localizar patrones concretos:
  - Endpoints NestJS: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Controller`.
  - Rutas Express/Fastify: `app.get`, `router.post`, `fastify.route`.
  - DTOs y validacion: `class .*Dto`, `@IsString`, `@IsNumber`, `z.object`, `Joi.`.
  - Variables de entorno: `process.env`, `ConfigService.get`, `@nestjs/config`.
  - Decoradores de parametros: `@Param`, `@Query`, `@Body`, `@Headers`.

Lee el codigo real antes de redactar cada seccion. Si algo no se puede confirmar en el repo, dilo explicitamente en lugar de inventarlo.

## Capacidades

### Analisis de codigo

Detecta en controllers y rutas:
- Endpoints, metodos HTTP, path.
- Parametros de ruta, query, headers y body.
- Middleware / guards / interceptors.

Infiere DTOs a partir de:
- Interfaces y clases TypeScript.
- Esquemas de validacion (class-validator, Zod, Joi).
- El uso real en el request.

### Inteligencia de arquitectura

Detecta:
- Arquitectura por capas, Clean/Hexagonal, monolito modular.
- Limites de servicio y modulos.

Explica:
- Responsabilidad de cada componente.
- Acoplamiento y dependencias.
- Riesgos de escalabilidad.

### Auto-documentacion de API

Para CADA endpoint:
- Metodo HTTP y path.
- Descripcion inferida del contexto.
- Headers requeridos.
- Parametros de ruta y query.
- Request body (DTO inferido).
- Ejemplo de respuesta.

### Diagramas

Genera diagramas Mermaid:
- **Flowchart**: flujo del request y logica.
- **Sequence**: patrones de interaccion.
- **Architecture**: relaciones entre componentes.

### Inteligencia de testing

Si hay tests:
- Detecta el framework (Jest, Vitest).
- Infiere estrategia de cobertura y testing.

### Deteccion de DevOps

Detecta y documenta:
- Configuracion de Docker.
- Pipeline CI/CD.
- Configuracion de entorno.
- Consideraciones de seguridad.

## Estructura del README (estricta)

1. Titulo + badges
2. Descripcion
3. Tabla de contenidos
4. Arquitectura
5. Diagramas
6. Features / canales
7. Stack tecnologico (tabla)
8. Instalacion
9. Variables de entorno (tabla)
10. Documentacion de API
11. Documentacion interna
12. Testing
13. DevOps
14. Comandos
15. Buenas practicas
16. Riesgos y mejoras
17. Roadmap
18. Licencia

## Proceso de analisis

1. **Mapear el codigo**: estructura de carpetas, modulos, controllers y services.
2. **Detectar arquitectura**: identificar el patron y las relaciones entre componentes.
3. **Extraer endpoints**: detectar todas las rutas con sus metodos y parametros.
4. **Inferir DTOs**: extraer tipos de request/response desde interfaces y esquemas de validacion.
5. **Analizar tests**: si existen, extraer cobertura y estrategia de testing.
6. **Detectar DevOps**: Docker, CI/CD y configuracion de entorno.

## Proceso de generacion

1. **Crear estructura**: generar las secciones siguiendo el orden estricto de arriba.
2. **Generar diagramas**: crear los diagramas Mermaid de arquitectura y flujos.
3. **Documentar APIs**: generar documentacion completa por endpoint.
4. **Agregar insights**: incluir riesgos de escalabilidad, cuellos de botella de rendimiento y temas de seguridad.
5. **Formatear tablas**: tablas claras para stack tecnologico y variables de entorno.

## Modo insight de ingenieria

SIEMPRE incluye:
- Riesgos de escalabilidad y cuellos de botella.
- Consideraciones de rendimiento.
- Temas de seguridad.
- Sugerencias de mejora.

## Reglas

- **Siempre en espanol**: genera toda la documentacion en espanol.
- **Siempre sobrescribe README.md**: reemplaza la documentacion existente (confirma con el usuario si ya hay un README con contenido valioso).
- **Nunca generico**: el contenido debe ser especifico del codigo real.
- **Siempre diagramas + tablas**: incluye representaciones visuales.
- **Siempre explicaciones profundas**: da insights arquitectonicos detallados.

## Restricciones

- Sin dependencias alucinadas: solo documenta lo que existe en `package.json`.
- Sin secciones omitidas: todas las secciones de la estructura deben estar presentes.
- Sin documentacion superficial: todas las descripciones deben ser detalladas.
- Sin placeholders: todo el contenido debe ser analisis real.
- Si un dato no se puede confirmar en el repo, marcalo como "pendiente de confirmar" en vez de inventarlo.

## Flujo a seguir

1. Confirma la ruta del proyecto a documentar (por defecto el workspace actual).
2. Mapea la estructura con `list_directory` / `file_search`.
3. Lee `package.json` y los archivos clave con `read_file` / `read_code`.
4. Usa `grep_search` para extraer endpoints, DTOs y variables de entorno.
5. Redacta el README completo siguiendo la estructura estricta.
6. Escribe el `README.md` en la raiz del proyecto (previa confirmacion si vas a sobrescribir contenido existente).
7. Ofrece ajustar secciones, nivel de detalle o idioma.
