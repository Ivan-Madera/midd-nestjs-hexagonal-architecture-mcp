---
name: midd-audit-unused-dependencies
description: Audita las dependencias declaradas en el package.json de un proyecto Node.js y cruza cada una contra su uso real en el codigo, analizando en profundidad el arbol de dependientes (peer requerido vs opcional, transitiva redundante, huerfana) para dar un veredicto por paquete (mantener, quitar, mover a devDependencies, o decision de config). Usala cuando el usuario pida detectar librerias sin uso, limpiar el package.json, revisar dependencias instaladas por error, saber si una dependencia se usa de verdad, o auditar dependencias directas vs transitivas.
---

# Auditar dependencias sin uso (cruce codigo + arbol de dependientes)

Guia para auditar las dependencias de un proyecto **Node.js / npm** y decidir, paquete por paquete, si se mantiene, se quita, se reclasifica a `devDependencies`, o es una decision de configuracion. El analisis tiene **dos ejes** que hay que cruzar siempre:

1. **Uso real en el codigo:** se importa / referencia el paquete en el codigo fuente, configs o scripts?
2. **Posicion en el arbol de dependientes:** quien mas lo necesita? Es un peer **requerido**, un peer **opcional**, una transitiva que ya trae otro paquete, o una **huerfana** sin dependientes?

Un paquete solo es "eliminable sin riesgo" cuando falla en **ambos** ejes: no lo usa tu codigo **y** nadie mas en el arbol lo requiere. Ese cruce es el corazon de la skill; no te quedes solo con "no aparece en los imports".

Usa esta skill cuando el usuario pida: "detecta librerias que no se usan", "limpia el package.json", "a veces instalamos cosas por error y ahi quedan", "esta librerÃ­a se usa de verdad?", "cruza las dependencias con el codigo", o similar.

## Principios

- **Doble evidencia antes de condenar.** No marques una dependencia como eliminable solo porque no tiene imports. Confirma tambien que ningun otro paquete del arbol la requiere (y, si la requiere, si ese peer es requerido u opcional). Lo contrario tambien aplica: que algo no se importe no significa que sobre (ver cargas implicitas abajo).
- **Cargas implicitas existen.** Hay paquetes que se usan sin aparecer en ningun `import`:
  - **Drivers de base de datos** (p. ej. `mssql`, `better-sqlite3`, `pg`): los carga el ORM por string de configuracion (`type: 'mssql'`), no por import.
  - **Metadatos de decoradores** (`reflect-metadata`): requerido en runtime si el `tsconfig.json` tiene `emitDecoratorMetadata: true` y hay decoradores de NestJS/TypeORM.
  - **Herramientas de CLI/config**: `eslint`, `prettier`, `jest`, el CLI del framework (`nest`, `@nestjs/cli`) se usan por scripts o archivos de config, no por imports del codigo fuente.
  - **Registros por `-r`/`--require`** en scripts: `node -r ts-node/register -r tsconfig-paths/register ...`. Cuentan como uso, pero solo de ese script.
- **Peer requerido != peer opcional.** Un peer **requerido** (p. ej. `rxjs` para `@nestjs/*`) debe vivir en el `package.json` raiz aunque tu codigo no lo importe; quitarlo genera warnings y un arbol fragil. Un peer **opcional** (p. ej. los drivers de `typeorm`, marcados en `peerDependenciesMeta` como `optional: true`) solo hace falta si de verdad usas esa funcionalidad.
- **Transitiva redundante vs huerfana.** Si un paquete aparece en tus dependencias directas pero ademas lo trae otro paquete como transitiva, tu declaracion directa es **redundante** (quitarla no lo desinstala; sigue llegando por el otro). Si no lo trae nadie mas (sin padres en el arbol), es **huerfana**: quitarlo si lo desinstala.
- **Clasificacion correcta (dep vs devDep).** Un paquete que solo se usa en tests, build o tooling debe estar en `devDependencies`, no en `dependencies`. Mal clasificar infla la imagen de produccion (sobre todo binarios nativos).
- **No se elimina nada dentro de la skill por defecto.** La skill **diagnostica y recomienda**. Aplicar los cambios al `package.json` requiere confirmacion explicita del usuario. Nunca borres dependencias sin aprobar el veredicto con el.
- **Reporte final siempre.** Entrega una tabla por paquete con: usado en codigo (si/no/implicito), dependientes en el arbol, tipo de peer, y veredicto con su razon.

## Requisitos previos

1. `node` y `npm` disponibles (`node --version`, `npm --version`).
2. El proyecto debe tener `node_modules` instalado para que `npm ls` refleje el arbol real. Si no esta, instala primero (`npm install`) o avisa al usuario de que el analisis del arbol sera incompleto.
3. Herramientas de lectura del codigo: usa el grep/busqueda del entorno para rastrear imports; **no** uses comandos de shell para leer archivos cuando haya una herramienta dedicada.
4. (Opcional) `npx depcheck` como segunda opinion automatizada para los dudosos. Es solo-lectura.

## Fase 0 - Inventario

1. Lee el `package.json` y haz la lista completa de `dependencies` y `devDependencies` (separadas).
2. Lee los `scripts` del `package.json`: anota que paquetes invocan por nombre (`nest`, `jest`, `eslint`, `prettier`, `tsc`) y cuales por `-r`/`--require` (`ts-node/register`, `tsconfig-paths/register`). Un paquete usado solo por un script cuenta como "usado por ese script" (importante para decidir si el script sigue vivo).
3. Localiza los archivos de configuracion relevantes y leelos, porque enganchan paquetes sin imports:
   - `tsconfig.json` / `tsconfig.build.json` (p. ej. `emitDecoratorMetadata` -> `reflect-metadata`).
   - `.eslintrc.*` (que `extends`/`plugins`/`parser` referencia: si un `eslint-plugin-*` o `eslint-config-*` NO aparece aqui, esta instalado pero desconectado).
   - `nest-cli.json` (si activa `webpack` -> `ts-loader` puede hacer falta; si no, no).
   - config de `jest` (en `package.json` o `jest.config.*`), `.prettierrc`, `babel.config.*`.
4. Mapea la estructura de `src` (y `test/` si existe) para saber donde buscar imports. Verifica que los directorios referenciados por scripts existan (p. ej. si `test:e2e` apunta a `./test/jest-e2e.json`, comprueba que ese archivo exista; si no, el script y sus deps asociadas son candidatos a sobrar).

## Fase 1 - Uso en el codigo (eje 1)

Para **cada** dependencia, rastrea su uso real con busquedas de patron sobre el codigo fuente (`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`, y configs):

1. Patrones de import a buscar por paquete `<pkg>`:
   - `from ['"]<pkg>` (import ESM)
   - `require(['"]<pkg>` (CommonJS)
   - para scoped packages recuerda escapar: `@scope/name`.
   - subpaths: `<pkg>/algo` (p. ej. `ts-node/register`, `rxjs/operators`).
2. Casos especiales (cargas implicitas, del principio): busca tambien el string de config, no solo el import. Ejemplos:
   - driver de BD: busca `type: '<driver>'` ademas del import.
   - `reflect-metadata`: revisa `emitDecoratorMetadata` en tsconfig.
   - plugins de eslint/prettier: revisa el `.eslintrc`.
3. Clasifica cada paquete en el eje 1 como:
   - **Usado** (hay imports/referencias en codigo de produccion).
   - **Usado solo en tests/tooling** (los imports estan solo en `*.spec.ts`, `test/`, configs, o scripts de dev).
   - **Implicito** (no hay import, pero una config/driver/decorador lo exige).
   - **Sin uso aparente** (ni import ni referencia de config).

> Limitacion honesta: el grep estatico no detecta cargas 100% dinamicas (`require(variable)`, imports construidos en runtime). Dilo en el reporte y, para los dudosos, apoyate en `depcheck` y en el conocimiento del dominio.

## Fase 2 - Arbol de dependientes (eje 2)

Para cada dependencia **dudosa o sin uso aparente** (y para las implicitas que quieras confirmar), inspecciona el arbol real instalado:

1. Quien depende de ella:
   ```
   npm ls <paquete> --all
   ```
   - Si solo aparece como raiz sin padres (`â””â”€â”€ <pkg>@x.y.z` colgando directo del proyecto) -> **huerfana**: nadie mas la usa.
   - Si aparece `deduped` bajo otros paquetes -> otros la **comparten/requieren**; tu declaracion directa puede ser redundante.
2. Si otro paquete la lista, averigua si es **peer requerido u opcional**:
   ```
   npm view <paquete-padre> peerDependencies
   npm view <paquete-padre> peerDependenciesMeta
   ```
   - Aparece en `peerDependencies` y **no** esta marcada `optional: true` en `peerDependenciesMeta` -> **peer requerido** (mantener en el raiz).
   - Marcada `optional: true` -> **peer opcional** (solo si usas esa feature; p. ej. drivers de `typeorm`).
3. Para confirmar que una transitiva ya llega por otro camino (y por tanto tu dep directa es redundante), basta con que `npm ls <paquete>` la muestre bajo un padre ademas de en la raiz.

## Fase 3 - Veredicto por paquete

Cruza eje 1 (uso en codigo) con eje 2 (arbol) y asigna uno de estos veredictos:

- **Mantener (peer requerido / uso directo):** se usa, o es peer requerido de un framework aunque no se importe (p. ej. `rxjs`, `reflect-metadata` con NestJS). No tocar.
- **Mover a `devDependencies`:** se usa, pero solo en tests/build/tooling (p. ej. un driver de BD usado unicamente en el modulo de tests). Alivia produccion.
- **Quitar (huerfana):** sin uso en codigo **y** sin dependientes en el arbol. Quitarla la desinstala; es segura de borrar.
- **Quitar de directas (redundante):** sin uso directo y, aunque la declares, ya la trae otro paquete como transitiva. Quitarla de tu `package.json` no la desinstala. Salvo que una config/arranque tuyo la cargue explicitamente.
- **Decision de config:** instalada pero desconectada de su config (p. ej. `eslint-plugin-prettier` / `eslint-config-prettier` que no estan en `.eslintrc`). Dos caminos: quitarla, o engancharla correctamente en la config. Deja la eleccion al usuario.
- **Mantener (peer opcional en uso):** peer opcional que SI usas (el driver de BD de tu entorno). Mantener.

Para cada veredicto, registra la **evidencia concreta**: archivos y lineas donde se importa (o la ausencia), salida de `npm ls`, y la declaracion de peer que lo respalda.

## Fase 4 (opcional) - Segunda opinion automatizada

Corre, si el usuario lo permite:
```
npx depcheck
```
Contrasta su lista de "unused dependencies" y "missing dependencies" con tu analisis. `depcheck` es util pero tiene falsos positivos (no entiende drivers por string ni algunos plugins), por eso **no sustituye** el cruce manual: lo usa como refuerzo para los dudosos.

## Fase 5 (opcional, bajo confirmacion) - Aplicar el cleanup sin matar el proyecto

Solo si el usuario aprueba el veredicto. El objetivo es limpiar **sin romper nada**, asi que se aplica de forma conservadora y se verifica antes de dar por hecho el cambio.

1. **Snapshot del estado previo.** Antes de editar, anota las versiones y la clasificacion (dep/dev) de cada paquete que vas a tocar, para poder construir el reporte de cambios y revertir si hace falta. Si el working tree tiene cambios sin commitear, avisale al usuario (la skill no hace checkpoint de git).

2. **Aplica solo lo seguro por defecto.** A menos que el usuario pida explicitamente mas:
   - **Eliminar** unicamente las **huerfanas confirmadas** (sin uso en codigo Y sin dependientes en el arbol).
   - **Mover a `devDependencies`** lo mal clasificado (usado solo en tests/build/tooling). Al moverlo, respeta el orden alfabetico del bloque destino.
   - **NO toques** por iniciativa propia: peers requeridos (`rxjs`, `reflect-metadata`), redundantes que carga un script (`ts-node`, `tsconfig-paths`, `source-map-support` via `test:debug`), ni las de config (prettier/eslint). Esas quedan como recomendacion para que el usuario decida; aplicalas solo si lo confirma.

3. **Edita el `package.json`** quitando/moviendo las lineas acordadas. No borres el bloque `overrides` ni cambies versiones aqui: esta skill audita uso, no versiones.

4. **Reinstala de forma incremental (rapido, no borres `node_modules`).** `npm install` reconcilia el arbol con el nuevo `package.json` en segundos y actualiza el lock; deberia reportar `removed N packages` por las huerfanas y sus sub-arboles. Borrar `node_modules` aqui solo agrega recompilacion de binarios nativos sin beneficio. Si el install compila nativos y tarda, lanzalo en background con marcador de fin y espera a que termine.

5. **Verifica que el proyecto sigue vivo** (esto es lo que evita "matar el proyecto"):
   ```
   npm run build
   ```
   y corre los tests si existen (`npm test`). Los tests son especialmente importantes cuando moviste un driver de BD a devDependencies: confirman que la funcionalidad que lo usa (los tests) sigue resolviendolo. Si algo falla con `Cannot find module <pkg>`, el grep no vio una carga dinamica: **reintroduce ese paquete**, reclasificalo como "mantener (carga dinamica/implicita)" y vuelve a verificar.

6. **Entrega el reporte de cambios** (seccion siguiente). No des el cleanup por terminado hasta que build + tests pasen y el reporte este entregado.

## Reporte de diagnostico (obligatorio tras Fase 3)

Entrega una tabla con una fila por dependencia auditada:

| Paquete | Tipo (dep/dev) | Usado en codigo | Dependientes en arbol | Peer (req/opt/no) | Veredicto | Razon/Evidencia |

Y debajo, agrupa en listas accionables:

- **Eliminables sin riesgo (huerfanas):** ...
- **Redundantes como directas (las trae otro paquete):** ...
- **Reclasificar a devDependencies:** ...
- **Decision de config (quitar o enganchar):** ...
- **Mantener (peers requeridos / uso directo):** ...

Cierra con las **limitaciones** del analisis (cargas dinamicas no detectables por grep) y el **siguiente paso sugerido** (aplicar cleanup seguro, decidir dudosos, correr depcheck).

Entrega el reporte en el chat. Si el usuario lo pide, guardalo como archivo (p. ej. `docs/dependency-audit.md`).

## Reporte de cambios (obligatorio tras Fase 5)

Cuando se aplico el cleanup, ademas del diagnostico, entrega un **reporte de los cambios realmente hechos**, para que el usuario vea exactamente que se movio. Incluye:

- **Resultado de verificacion (primero, es lo que prueba que no se mato el proyecto):** estado de `npm run build` (exit 0 o error) y de los tests (`X passed / Y total`, suites), y cuantos paquetes removio el install (`removed N packages`). Si no hay tests, dilo explicitamente.
- **Eliminadas:** por cada paquete quitado -> nombre, version anterior, de que bloque salio (dep/dev), y la razon (huerfana sin dependientes / 0 imports / script inexistente).
- **Reclasificadas:** por cada movida -> nombre, version, bloque origen -> bloque destino, y por que (p. ej. "solo se usa en el modulo de tests").
- **Intactas a proposito:** lista corta de lo que NO se toco y por que (peers requeridos, redundantes que usa un script, decisiones de config pendientes). Esto deja claro que la omision fue deliberada, no un olvido.
- **Archivos modificados:** `package.json` y `package-lock.json` (y si quedaron sin commitear).
- **Pendientes / siguiente paso:** los dudosos que el usuario aun debe decidir (quitar redundantes, enganchar o quitar prettier/eslint) y la oferta de commitear.

Formato sugerido para el bloque de cambios aplicados:

```
Verificacion: build exit 0 Â· 45/45 tests (11 suites) Â· removed 16 packages
Eliminadas:    supertest (7.3.1, devDep, huerfana) Â· @types/supertest (7.2.1, devDep) Â· ts-loader (9.6.2, devDep, sin dependientes)
Reclasificada: better-sqlite3 (12.x) dependencies -> devDependencies (solo usado en tests)
Intactas:      rxjs, reflect-metadata (peers requeridos) Â· ts-node, tsconfig-paths, source-map-support (las usa test:debug)
```

Entrega el reporte en el chat. Si el usuario lo pide, guardalo como archivo (p. ej. `docs/dependency-cleanup.md`).

## Flujo resumido

1. **Fase 0:** inventariar `dependencies`/`devDependencies`, leer `scripts` y configs (`tsconfig`, `.eslintrc`, `nest-cli.json`, jest), mapear `src`/`test`.
2. **Fase 1 (eje codigo):** grep de imports/`require`/subpaths + strings de config por cada paquete -> usado / solo-tests / implicito / sin-uso.
3. **Fase 2 (eje arbol):** `npm ls <pkg> --all` (huerfana vs compartida) + `npm view <padre> peerDependencies(Meta)` (requerido vs opcional) para los dudosos.
4. **Fase 3:** cruzar ejes y asignar veredicto por paquete con evidencia -> **Reporte de diagnostico** (tabla + listas accionables).
5. **Fase 4 (opcional):** `npx depcheck` como segunda opinion.
6. **Fase 5 (opcional, con OK del usuario):** snapshot previo -> aplicar solo lo seguro (quitar huerfanas, mover mal clasificadas a devDeps; no tocar peers ni redundantes de scripts sin confirmar) -> `npm install` incremental (sin borrar `node_modules`) -> **verificar build + tests** (si falla `Cannot find module`, reintroducir el paquete como carga dinamica) -> **Reporte de cambios**.
7. **Dos reportes:** de **diagnostico** (siempre, tras Fase 3) y de **cambios** (si se aplico Fase 5, con el resultado de la verificacion primero).
