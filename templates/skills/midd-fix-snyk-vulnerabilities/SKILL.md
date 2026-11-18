---
name: midd-fix-snyk-vulnerabilities
description: Resuelve vulnerabilidades de dependencias en un proyecto Node.js/npm usando Snyk, mediante un flujo escalonado de 4 fases (actualizaciones menores, mayores, overrides, y versiones recomendadas por Snyk). Usala cuando el usuario pida escanear y limpiar vulnerabilidades, arreglar el package.json, correr Snyk, o reducir los CVE de un repo npm.
---

# Resolver vulnerabilidades con Snyk (flujo escalonado)

Guia para limpiar las vulnerabilidades de dependencias de un proyecto **Node.js / npm** usando **Snyk**, escalando del cambio menos invasivo al mas invasivo. Despues de cada cambio de versiones se **regenera el `package-lock.json` y se reescanea con Snyk**; la **compilacion** (`npm run build`) se hace una vez, al final, para confirmar que el codigo sigue funcionando. No se avanza a una fase mas invasiva si la actual ya dejo el repo limpio.

Usa esta skill cuando el usuario pida: "escanea con Snyk", "arregla las vulnerabilidades del package.json", "limpia los CVE", "actualiza las dependencias vulnerables", o similar.

## Principios

- **Escalamiento progresivo.** Se intenta primero lo mas seguro (patch/minor dentro del rango semver). Solo si queda vulnerable se pasa a majors, luego a overrides, y al final a las versiones exactas que recomienda Snyk.
- **Snyk escanea el lock, no `node_modules`.** `snyk test` lee el `package-lock.json`. Por eso, para que cada fase sea correcta basta con **regenerar el lock** (`npm install --package-lock-only`), no con reinstalar todo `node_modules`. Esto evita recompilar binarios nativos (p. ej. `better-sqlite3`, `mssql`) en cada fase, que es el principal costo de tiempo. Lo que de verdad necesita cada fase es que no queden resoluciones viejas pegadas en el lock, y eso lo logra la regeneracion del lock.
- **Borrar `node_modules` solo cuando haga falta.** El borrado completo de `node_modules` se reserva para dos momentos: (a) al inicio de la Fase 1, junto con el borrado del bloque `overrides`, para partir de una base limpia; y (b) en la verificacion final, antes del `npm run build`, para reconstruir el arbol completo y descartar restos de installs interrumpidos. Dentro de cada fase intermedia NO se borra `node_modules`: solo se regenera el lock y se reescanea.
- **Base limpia de overrides al empezar.** En la **primera** limpieza (Fase 1), ademas de borrar `package-lock.json` y `node_modules`, elimina tambien el bloque `overrides` existente del `package.json`. Muchos overrides viejos quedan resueltos solos por las actualizaciones menores de las librerias; arrastrarlos fuerza versiones redundantes, puede trabar el arbol de dependencias y enmascara que vulnerabilidad se arreglo de verdad. Se parte sin overrides y solo se vuelven a introducir, de forma justificada, en la Fase 3 (o la 4) si siguen haciendo falta.
- **Verificar que el codigo funciona.** La verificacion de que el codigo compila (`npm run build` / `tsc` + tests si existen) se hace **una vez, al final**, tras un install completo y limpio. Durante las fases intermedias la verificacion es Snyk sobre el lock regenerado. Si la verificacion final deja el repo roto o aun vulnerable, se pasa a la siguiente fase o se ajusta el codigo segun corresponda.
- **Installs completos en background.** Cuando SI toque un install completo (los que compilan binarios nativos: inicio de Fase 1 y verificacion final), lanzalo como proceso en background con un marcador de fin y espera a que termine, en vez de un comando con timeout corto que se corte a medias y deje el arbol inconsistente (sintoma tipico: `Cannot find module ...` al compilar, o falta `node_modules/.bin/<cli>`).
- **Criterio humano en los gates.** Decidir si un major "afecta el codigo", aprobar overrides, o aceptar una vulnerabilidad sin fix, requiere confirmacion del usuario. No automatices esas decisiones a ciegas.
- **No se hace checkpoint de git dentro de la skill.** Se asume que el usuario ya hizo commit antes de invocarla. Si el working tree tiene cambios sin commitear al empezar, avisale.
- **Los majors pueden subir el Node minimo.** Un major (del framework, su CLI o una transitiva) puede exigir una version de Node mas alta en su campo `engines`. Siempre que se suba un major, compara esos `engines` contra el Node de la maquina local, el del `Dockerfile` y el del CI, y **avisa al usuario** si alguno queda por debajo. No actualices Node local ni la imagen Docker sin su confirmacion.
- **Reporte final en todas las ramas.** Termine limpio o no, se entrega un resumen de lo que se actualizo, los overrides aplicados y lo que quedo sin resolver con su razon.

## Requisitos previos

1. Snyk CLI instalado. Verifica con `snyk --version`. Si no esta, instala con `npm i -g snyk` (o indica al usuario que lo haga).
2. Comandos clave segun el momento:
   - **Regenerar solo el lock (rapido, en cada fase):**
     - `npm install --package-lock-only`
   - **Borrar `node_modules` (solo inicio de Fase 1 y verificacion final).** En **Windows PowerShell**:
     - `Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue`
     En **bash/macOS/Linux**:
     - `rm -rf node_modules`
   - **Borrar lock + modulos (base totalmente limpia, inicio de Fase 1).** Windows PowerShell:
     - `Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue`
     bash/macOS/Linux:
     - `rm -rf node_modules package-lock.json`
   - **Install completo (background, inicio de Fase 1 y verificacion final):** lanza `npm install` como proceso en background con un marcador de fin (p. ej. `npm install; echo INSTALL_DONE`) y espera a que termine antes de seguir. No lo cortes a mitad.
3. Comando de build del repo: lee `package.json`. En este tipo de proyecto suele ser `npm run build` (que ejecuta `tsc` / `nest build`). Si no hay script `test`, la verificacion se limita a que compile; dilo explicitamente.

## Fase 0 - Autenticacion y escaneo base

1. **Autenticar Snyk por navegador.** Ejecuta:
   ```
   snyk auth
   ```
   Esto abre el navegador para que el usuario inicie sesion y guarda el token automaticamente en la config local. Verifica con:
   ```
   snyk config get api
   ```
   (debe devolver un token). Si `snyk auth` no puede abrir el navegador, imprime la URL para que el usuario la abra manualmente.
2. **Escaneo base.** Con las dependencias instaladas, corre:
   ```
   snyk test
   ```
   Guarda el resultado como linea base: cuantas vulnerabilidades, de que severidad, en que paquetes y que fix recomienda Snyk para cada una (`Upgrade <pkg> to <version>`, `No upgrade path`, etc.). Este reporte alimenta todas las fases siguientes.
3. Si el escaneo base ya sale **limpio** (0 vulnerabilidades), compila para confirmar y entrega el reporte final. Fin.

## Fase 1 - Actualizaciones menores (patch / minor, dentro del rango semver)

1. Parte de una base limpia. Es el **unico** punto del flujo donde se borra lock + modulos de una sola vez:
   ```
   Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
   ```
   Ademas, abre el `package.json` y **borra el bloque `overrides`** si existe. Dejas el proyecto sin overrides para que las actualizaciones menores resuelvan de forma natural lo que puedan; los overrides solo se reintroducen, si hacen falta, en la Fase 3/4. Luego lanza un **install completo en background** (ver Requisitos) y espera a que termine, para tener `node_modules` consistente de arranque.
2. Corre:
   ```
   npm outdated
   ```
   Cruza las columnas: toma las dependencias donde `Wanted` difiere de `Current` (cambios **menores/patch** compatibles con el rango actual del `package.json`). Actualiza esas (`npm update <pkg>` o ajustando el rango del `package.json` si esta pineado a version exacta). Prioriza las que Snyk marco como vulnerables. Nota: si una dependencia vulnerable esta pineada a version exacta (sin `^`/`~`), `npm update` no la movera; ajusta su rango en el `package.json` a la version segura que indica Snyk.
3. Regenera el lock y reescanea (sin reinstalar `node_modules`):
   ```
   npm install --package-lock-only
   snyk test
   ```
4. **Gate:** si Snyk quedo limpio -> pasa a la **verificacion final** (install completo + build) y reporte. Si no -> Fase 2.

## Fase 2 - Actualizaciones mayores (major) que no rompan el codigo

1. No borres `node_modules`. Parte del estado que dejo la Fase 1.
2. Corre `npm outdated` y cruza por la columna `Latest` vs `Current`: estos son **majors**. Para cada paquete vulnerable con major disponible:
   - Revisa el changelog / breaking changes del major.
   - **Gate de decision:** si el major NO afecta el codigo del repo, ajusta su version en el `package.json`.
   - Si el major **SI afecta el codigo**, implementa los cambios de codigo necesarios para que compile y funcione con la nueva version (ajuste de imports, APIs renombradas, firmas cambiadas, etc.). Confirma con el usuario antes de refactors grandes.
3. Regenera el lock y reescanea:
   ```
   npm install --package-lock-only
   snyk test
   ```
4. **Chequeo de compatibilidad de Node (obligatorio si se subio algun major).** Ver la seccion "Chequeo de Node / Docker tras majors" mas abajo. Si algun entorno queda por debajo del minimo, detente y avisa al usuario antes de la verificacion final.
5. **Gate:** si Snyk quedo limpio -> **verificacion final** (install completo + build, que ademas valida que los majors no rompieron la compilacion) y reporte. Si no -> Fase 3. Si el major introdujo cambios de codigo, la compilacion se valida en la verificacion final; corrige ahi cualquier error antes de cerrar.

## Fase 3 - Overrides a versiones especificas que indica Snyk

1. No borres `node_modules`. Parte del estado anterior.
2. En el `package.json`, agrega un bloque `overrides` forzando las versiones especificas que Snyk indica como solucion de cada vulnerabilidad (tipicamente dependencias transitivas que no puedes subir desde el arbol directo):
   ```jsonc
   "overrides": {
     "<paquete-transitivo>": "<version-segura-que-indica-snyk>"
   }
   ```
3. Regenera el lock y reescanea:
   ```
   npm install --package-lock-only
   snyk test
   ```
   Nota: el override se refleja en la version **resuelta** del lock (entrada `node_modules/<pkg>`), no en la declaracion de dependencia del paquete padre. Verifica la version resuelta, no la declarada.
4. **Gate:** si Snyk quedo limpio -> **verificacion final** (install completo + build) y reporte. Si no -> Fase 4.

## Fase 4 - Versiones recomendadas por Snyk (ultimo recurso)

1. No borres `node_modules`. Parte del estado anterior.
2. **Elimina todos los overrides** de la Fase 3 y ve implementando, una por una, las versiones que el propio Snyk recomienda en su reporte (tanto en dependencias directas como ajustando el arbol).
3. Regenera el lock y reescanea:
   ```
   npm install --package-lock-only
   snyk test
   ```
4. Si quedan algunas pendientes, usa `overrides` puntuales para solventar esas especificas, regenera el lock y reescanea otra vez:
   ```
   npm install --package-lock-only
   snyk test
   ```
5. Cuando Snyk quede limpio (o no se pueda avanzar mas), pasa a la **verificacion final** (install completo + build) para validar que el codigo compila. Si las versiones recomendadas por Snyk incluyen majors, corre antes el "Chequeo de Node / Docker tras majors".
6. Si **sigue sin quedar limpio**, detente y en el reporte final indica **cuales vulnerabilidades no se solventaron y por que** (sin fix path disponible, requeriria un major que rompe el codigo y el usuario no lo aprobo, conflicto de dependencias, etc.).

## Chequeo de Node / Docker tras majors

Obligatorio cada vez que se sube un major (Fase 2, o Fase 4 si Snyk recomienda majors). Un major puede subir el Node minimo de forma directa o a traves de una transitiva (p. ej. el CLI del framework arrastra otra libreria que exige Node mas nuevo). Si no se revisa, el build puede fallar con errores que no apuntan al Node (p. ej. `ERR_REQUIRE_CYCLE_MODULE` al hacer `require()` de un paquete ESM en un Node que aun no lo soporta bien).

1. **Calcula el Node minimo requerido.** Junta el campo `engines.node` de los paquetes que subiste de major y de sus dependencias. La forma mas rapida es ver los warnings `EBADENGINE` del `npm install` (indican paquete, version requerida y version actual). Para confirmar uno puntual:
   ```
   npm view <paquete>@<version> engines
   ```
   El minimo efectivo es el mas restrictivo de todos (p. ej. `^22.22.3 || ^24.15.0 || >=26.0.0`).
2. **Compara contra cada entorno:**
   - **Node local:** `node --version`.
   - **Docker:** las lineas `FROM` del `Dockerfile` (todas las etapas). Distingue entre tag **flotante** (`node:22-alpine`, que baja la ultima 22.x y puede ya cumplir) y tag **fijo** (`node:22.13-alpine`, que no se mueve y puede quedar por debajo).
   - **CI / otros:** `.nvmrc`, `.node-version`, `engines` del propio `package.json`, `node-version` en workflows de CI (`.github/workflows/*.yml`, `azure-pipelines.yml`, `.gitlab-ci.yml`), si existen.
3. **Clasifica cada entorno y avisa al usuario** con una tabla corta:

   | Entorno | Version actual | Minimo requerido | Estado |
   |---|---|---|---|
   | Node local | 22.13.0 | ^22.22.3 \|\| ^24.15.0 | **Obligatorio actualizar** |
   | Dockerfile | `node:22-alpine` (flotante) | igual | Cumple, actualizar es opcional (alineacion) |

   - **Obligatorio actualizar:** la version queda por debajo del minimo (Node local viejo, tag de Docker fijo viejo). El build o el runtime van a fallar.
   - **Opcional / recomendado:** ya cumple (p. ej. por tag flotante), pero conviene alinearlo con el Node local para no depender del tag.
   - **No verificable:** no hay forma de saber la version (p. ej. CI sin version declarada). Dilo explicitamente.
4. **No actualices nada sin confirmacion.** Instalar otro Node local o cambiar el `FROM` del `Dockerfile` es decision del usuario: propon el cambio exacto (version y comando, p. ej. `winget install --id OpenJS.NodeJS.LTS --version <x.y.z>`) y espera su OK. Si el usuario lo aprueba y se cambia el `Dockerfile`, valida con `docker build` que la imagen compile.

## Verificacion final (una sola vez, al cerrar cualquier fase que quedo limpia)

Antes de entregar el reporte, confirma que el codigo compila con el arbol real:

1. Borra `node_modules` (no el lock) para descartar restos de installs interrumpidos:
   ```
   Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
   ```
2. Lanza un **install completo en background** (ver Requisitos) y espera a que termine. Confirma que existen los bin-links que necesita el build (p. ej. `node_modules/.bin/nest`).
3. Reescanea y compila:
   ```
   snyk test
   npm run build
   ```
   (y tests si existen).
4. Si el build falla, corrige el codigo o las versiones y repite esta verificacion. Si vuelve a quedar vulnerable tras un cambio, retoma la fase que corresponda.

## Reporte final (obligatorio en todas las ramas)

Al terminar cualquier fase (limpio o no), entrega un resumen claro con:

- **Estado final:** limpio (0 vulnerabilidades) o numero y severidad de las que quedaron.
- **Fase donde se resolvio** (o ultima fase alcanzada).
- **Dependencias actualizadas:** paquete, version anterior -> version nueva, tipo (patch/minor/major).
- **Cambios de codigo** realizados por majors, si los hubo (archivos y que se ajusto).
- **Compatibilidad de Node / Docker** (si hubo majors): Node minimo requerido, version actual de cada entorno (local, `Dockerfile`, CI) y si actualizarlo es **obligatorio** u **opcional**. Si no hubo majors, dilo en una linea.
- **Overrides aplicados:** paquete y version forzada, y por que.
- **Vulnerabilidades sin resolver:** cada una con su id/paquete, severidad y la razon por la que no se solvento.
- **Siguiente paso sugerido** si quedo algo pendiente (p. ej. esperar fix upstream, aceptar el riesgo con `snyk ignore`, o planear un refactor mayor).

Entrega el reporte en el chat. Si el usuario lo pide, guardalo tambien como archivo (p. ej. `docs/snyk-report.md`).

## Flujo resumido

Regla general: **dentro de cada fase solo se regenera el lock (`npm install --package-lock-only`) + `snyk test`.** El borrado de `node_modules` y el `npm run build` ocurren solo al inicio de Fase 1 (base limpia) y en la verificacion final.

1. **Fase 0:** `snyk auth` (navegador) -> `snyk test` base. Si limpio, verificacion final y fin.
2. **Fase 1:** borrar lock/modulos **+ borrar el bloque `overrides`** -> install completo (background) -> `npm outdated` (Wanted vs Current, menores) -> ajustar versiones -> `npm install --package-lock-only` + `snyk test`. Si limpio -> verificacion final.
3. **Fase 2:** (sin borrar modulos) `npm outdated` (Latest vs Current, majors) -> ajustar los que no rompen; si rompen, ajustar codigo -> `npm install --package-lock-only` + `snyk test` -> **chequeo de Node / Docker** (engines vs local, `Dockerfile`, CI; avisar si hay que actualizar). Si limpio -> verificacion final.
4. **Fase 3:** (sin borrar modulos) `overrides` a las versiones que indica Snyk -> `npm install --package-lock-only` + `snyk test` (verifica la version resuelta). Si limpio -> verificacion final.
5. **Fase 4:** (sin borrar modulos) quitar overrides e implementar versiones recomendadas por Snyk -> `npm install --package-lock-only` + `snyk test` -> overrides puntuales para lo que falte -> regenerar lock + reescanear. Si no queda limpio, reportar cuales y por que.
6. **Verificacion final:** borrar solo `node_modules` -> install completo (background) -> `snyk test` + `npm run build` (+ tests). 
7. **Reporte final** en todas las ramas.
