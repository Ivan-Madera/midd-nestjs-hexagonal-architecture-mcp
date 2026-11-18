---
name: midd-feature-atlas-flow
description: Usala SOLO cuando el usuario pida una nueva feature, caso de uso, mejora, endpoint o cambio de codigo, o pida "ejecuta la skill de ahorro de tokens" (o genera/refresca el atlas). Acota el pedido, usa o crea un mapa persistente del repo para no releer todo el workspace, y lo actualiza al terminar. NO usar para "genera la documentacion inicial", "handoff", "reglas" ni AGENTS.md (eso es midd-generate-handoff-docs). No usar para preguntas o charla.
---

# Feature con atlas del repo

## Alcance y exclusividad

- Esta skill se ejecuta SOLO por pedido de feature/caso de uso/mejora/cambio de codigo, o de "ahorro de tokens" / atlas.
- NUNCA invoques ni ejecutes `midd-generate-handoff-docs`, ni generes `AGENTS.md`, `docs/handoff/` o reglas. Solo los lees como fuente (solo lectura). Si estan desactualizados o no existen, no los crees: sugierelo en una frase al cerrar.
- Si el pedido es "genera la documentacion inicial", "handoff", "reglas" o AGENTS.md, detente y usa `midd-generate-handoff-docs`.

Objetivo: gastar pocos tokens. Agnostico de lenguaje. Responde en espanol, sin relleno.

El atlas vive en `docs/atlas/` (crea `docs/` y la carpeta si faltan):
- `index.md`: resumen, convenciones, indice de modulos. Siempre se lee.
- `<modulo>.md`: uno por modulo. Solo se lee el que la feature toca.

## Reglas de ahorro

- Busqueda: atlas -> grep por simbolo -> `read_code` con selector -> lectura completa (ultimo recurso).
- Maximo 8 archivos de codigo por feature; si necesitas mas, avisa y justifica. El escaneo inicial completo (Fase 1) tiene su propio presupuesto y no cuenta contra esos 8: se hace una sola vez, con lecturas baratas (listados, grep de firmas, `read_code` sin selector para obtener firmas) y no lectura completa de cada archivo.
- Nunca leas `node_modules`, `dist`, `target`, `build`, lockfiles ni binarios.
- Respuesta minima: sin repetir codigo ni diffs; cita `archivo:linea`.
- El atlas nunca guarda secretos, valores de `.env`, tokens ni datos personales; solo nombres de variables.

## Orden obligatorio

1. Brief (solo si el objetivo es de nivel 3).  2. Validar el atlas; si falta y el workspace ya tiene codigo, haz el escaneo inicial completo (Fase 1) una sola vez; desde la segunda vez solo se actualiza lo cambiado.  3. Si el objetivo es de nivel 3, pregunta antes de editar; si no, sigue.  4. Implementar.  5. Verificar.  6. Crear o actualizar `index.md` y los `<modulo>.md` (si el atlas no existia, puede escribirse aqui).  7. Cierre con la plantilla de abajo.

## Modo "solo atlas"

Si piden "genera/refresca el atlas" sin feature: solo Fase 1 y Fase 3. "Genera" sin atlas previo = escaneo inicial completo; "refresca" = escaneo completo forzado aunque ya exista.

## Fase 0: Brief

El unico dato obligatorio es el objetivo. Si es vago, no le pidas al usuario que "sea mas especifico": propon algo concreto. Segun el caso:
1. **Claro o inferible con el atlas:** procede y anota lo decidido en `Decisiones:` del cierre.
2. **Ambiguo con un valor por defecto razonable:** procede con el defecto mas conservador y marcalo en `Decisiones:` del cierre para que el usuario lo corrija.
3. **Ambiguo sin defecto seguro, o de alto riesgo** (seguridad/autorizacion, escritura o borrado de datos, contratos publicos, reglas de negocio no inferibles como campos, columnas, validaciones o llamadas a terceros): pregunta ANTES de editar. Preguntas cerradas con una opcion recomendada, todas en un mensaje, maximo 3 (p.ej. "Con token o publico? Recomiendo publico"). Si faltan datos de negocio, pide ese dato exacto con la plantilla "que hace / donde vive / que recibe y devuelve".

Una sola ronda de preguntas: si sigue vago, procede con el supuesto mas conservador y marcalo como pendiente de confirmar. Nunca inventes reglas de negocio, columnas ni contratos con terceros. El alto riesgo siempre se pregunta, aunque el objetivo parezca claro.

Lo demas se resuelve solo:
- Archivos/modulos: salen del atlas, salvo que el usuario los nombre.
- Que NO tocar: alcance = lo que pide el objetivo, y nada mas. Aplica ademas cualquier "no tocar" que el usuario diga.
- Formato de respuesta: resumen de maximo 3 lineas, salvo que el usuario pida otro.
- Criterio de exito: siempre que el proyecto compile y levante.
- Tests: no se crean, salvo que el pedido los mencione de forma explicita.

## Fase 1: Atlas

**Si no existe `docs/atlas/index.md`**, crealo explorando barato:
- Primero busca documentacion preexistente y reutilizala: `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, inventarios (`docs/*inventory*`), steering (`.kiro/steering`), auditorias. Lee lo justo, resumelo en el atlas y enlaza el original en vez de duplicarlo. Explora el codigo solo para lo que esos documentos no cubren.
- **Si existe `docs/handoff/` (generado por `midd-generate-handoff-docs`), es la fuente primaria y NO se redescubre:**
  1. `## Convenciones`, `## Borde y transversales` y `arquitectura:` se resumen en una linea cada uno a partir de `AGENTS.md` y `docs/handoff/04-convenciones-y-deuda.md` (si existe), con enlace al original; no se copian ni se re-escanean. Explora el codigo solo para lo que el handoff no cubra.
  2. En `docs previas:` enlaza `docs/handoff/` y `AGENTS.md`.
  3. Frescura: compara el `Commit base` de la cabecera de los docs de handoff con `HEAD` (`git diff --name-only <base>..HEAD`). Si cambiaron mas de 30 archivos o el commit ya no existe, avisalo en una linea ("el handoff puede estar desactualizado; conviene correr midd-generate-handoff-docs en modo actualizacion") y verifica en el codigo, no en el handoff, lo que dependa de esos cambios.
  4. El handoff NO reemplaza el mapa por modulo: los `<modulo>.md` (simbolos clave y dependencias) se siguen creando con el escaneo barato de firmas. No leas `02-funcionamiento-actual.md` completo: lee solo la seccion del flujo que la feature toca.
  5. Para esta skill, `docs/handoff/` y `AGENTS.md` son de solo lectura: nunca los edites. Si descubres que el handoff esta equivocado, anotalo en `## Notas` del atlas.
- Directorios a profundidad 2-3, archivos de build, y solo firmas (grep de `class|interface|@Controller|@RestController|@Service|@Module`).
- Define "modulo" segun la organizacion del repo:
  - Por feature/bounded context: un modulo por carpeta de feature.
  - Por capa tecnica (tipico en Java: controller/service/repository/entity/dto): un modulo por feature de negocio, identificado por su controller, con su cadena controller -> service -> repository -> entity -> DTOs.
- **Escaneo inicial completo (solo la primera vez):** si el workspace ya tiene codigo y no existe `docs/atlas/index.md`, mapea TODO el proyecto antes de implementar, para que las siguientes ejecuciones solo agreguen o modifiquen. Pasos:
  1. Un listado recursivo (profundidad 2-3, ignorando `node_modules`, `dist`, `target`, `build`, `.git`, lockfiles y binarios) para identificar todos los modulos.
  2. Crea `index.md` completo (arranque, transversales, convenciones, catalogo de modulos, puntos de entrada).
  3. Crea un `<modulo>.md` por CADA modulo (no solo los que toca la feature). Para cada uno obtén solo firmas: `read_code` sin selector o grep de `class|interface|@Controller|@RestController|@Service|@Module|@Entity`. No leas cuerpos completos salvo que no haya otra forma de entender el modulo.
  4. Hasta ~100 modulos el escaneo es SIEMPRE completo: un `<modulo>.md` por cada uno, sin `sin detalle` ni `escaneo: parcial`. Solo en repos enormes (mas de ~100 modulos) detalla primero los modulos que toca la feature y los de mayor tamano o centralidad; el resto va como `sin detalle` en lista compacta (nombres separados por comas, copiados de UN listado, sin extension; un conteo como "51 controllers" no cumple). Marca `escaneo: parcial` en el indice y completa el resto de forma progresiva: al tocar un modulo `sin detalle`, crea su `.md`.
  5. Al terminar, escribe `escaneo: completo` (o `parcial`) y el `commit` en `index.md`.
  6. Si el workspace esta vacio o es un proyecto nuevo, no hay nada que escanear: crea solo `index.md` minimo.
- **Desde la segunda vez es incremental:** con `escaneo: completo`, nunca re-escanees todo; aplica solo el diff (ver "Si existe"). Re-escanea completo unicamente si el usuario lo pide ("refresca el atlas") o si cambiaron mas de 30 archivos.
- Lee UNA vez las reglas del proyecto/empresa y resumelas en `## Convenciones`.
- Registra en `## Borde y transversales` lo que afecta a toda feature y suele descubrirse tarde: arranque (`main.ts`/`Application`: prefijo, versionado, middlewares, guards, filtros y pipes GLOBALES), recursos compartidos (conexiones BD y tokens, config, logger, cliente HTTP, mapeo), trampas de helpers compartidos (p.ej. uno que traga errores) y el codigo de error MAS ALTO usado (obtenlo buscando el maximo en todo el repo; no anotes "el ultimo que vi").
- Clasifica `arquitectura:` en el indice con UNO de estos tres valores exactos (nada de "legacy/hexagonal" ni mezclas) y una linea de justificacion (evidencia observada). `mixto` solo si distintos modulos siguen estilos distintos entre si; un estilo uniforme que cumple en parte los estandares es `legacy`. Las brechas van a `## Notas`:
  - `estandar`: cumple `~/.kiro/skills/midd-feature-atlas-flow/standards.md` (leelo solo para clasificar o si el repo es estandar o nuevo).
  - `legacy`: no lo cumple. Describe su estructura REAL en `## Convenciones` (capas, naming, errores, formato de respuesta). No leas `standards.md`.
  - `mixto`: marca cual aplica en cada `<modulo>.md`.
- Anota en `## Patron de referencia` el caso de uso mas limpio del estilo vigente.

**Si existe**, lee `index.md` y valida `commit`:
- Si no existe en el historial o no es ancestro de `HEAD`, usa `git merge-base HEAD <commit>`; sin base comun, reconstruye solo los modulos del brief.
- `git diff --name-only <base>..HEAD` + `git status --short`. Relee SOLO lo cambiado y actualiza sus `<modulo>.md`. Si cambiaron mas de 30 archivos, regenera los modulos afectados en vez de parchear.

Luego lee solo los `<modulo>.md` que el brief necesita y los archivos de codigo requeridos.

No hace falta anunciar nada antes de editar: la arquitectura, las decisiones y los archivos existentes que modificaste se reportan en el Cierre. Si el usuario corrige la clasificacion, actualiza `arquitectura:` en el atlas y continua con la nueva.

## Fase 2: Implementar

- **Respeta lo que el handoff marca como intocable.** Si existe `AGENTS.md` o `docs/handoff/`, antes de editar lee la seccion "Que NO tocar" y las decisiones intencionales (`hechos-dados.md`) y comprueba que la feature no las toque ni las contradiga. No "arregles" un hecho dado. Si la feature exige alterar un flujo con efectos externos sin reversa, reordenar efectos secundarios o cambiar un hecho dado, pregunta antes de editar (cuenta como alto riesgo de la Fase 0). Los candidatos "pendientes de clasificar" no son decisiones ni errores confirmados: no los modifiques sin preguntar.
- **La arquitectura vigente manda.** `legacy`: mantén su estructura, naming, errores y formato de respuesta; imita el patron de referencia; no migres, no reorganices ni agregues capas, guards, cabeceras o contratos que el repo no usa. `estandar` o proyecto nuevo: aplica `standards.md`. `mixto`: sigue el estilo del modulo donde escribes. Un modulo nuevo en un repo legacy sigue el estilo del repo.
- Brecha relevante en legacy (seguridad, contrato, errores): anotala en `## Notas` y mencionala en una linea al cerrar; no la corrijas por tu cuenta.
- Si el pedido contradice el estilo o estandar vigente, pregunta cual manda, por cada punto.
- Un endpoint transversal (health, metricas) va en su propio modulo, no dentro de un modulo de negocio.
- Prefiere cambios aditivos (archivos nuevos). Si necesitas modificar codigo compartido, de seguridad o un contrato publico, y el objetivo no lo implica, pregunta antes de editar; si lo implica, listalo en `Existentes:` del cierre.
- Endpoints: revisa antes `## Borde y transversales`; los guards/middlewares globales aplican a toda ruta nueva (metodo, Content-Type, token). Si lo haces publico (sin token), indicalo en `Decisiones:` y marca el riesgo cuando consulte BD/APIs y no haya rate limit.
- Sin tests, refactors ni docs no pedidos.
- Terminado = el proyecto compila y debe levantar. Verifica compilando sin emitir (`tsc --noEmit` o equivalente); no lo arranques salvo que lo pidan, y di si no pudiste comprobar el arranque. Con errores de build preexistentes no los corrijas: usa el comando EXACTO y la linea base anotados en `## Notas`, filtra por archivos tocados y compara el total. Si el total difiere de la base, investiga antes de afirmar que compila (un error de configuracion puede impedir que se revisen los tipos). Al descubrir el comando correcto, anotalo en `## Notas`.
- Actualiza el atlas por modulo apenas lo termines, no solo al final.

## Fase 3: Actualizar el atlas (obligatorio)

Edita solo lo afectado:
- Modulo: archivos y simbolos nuevos, dependencias y `verificado`. Modulo nuevo: crea su `.md` y agregalo al indice.
- Lo que descubriste FUERA del atlas (conexiones, tokens, trampas, borde global, ultimo codigo de error) va en `## Borde y transversales` o en el modulo que toque, para que la proxima feature no lo busque.
- Aunque no edites codigo (p.ej. "ya lo hace el framework"), si tu conclusion describe el borde (cabeceras, seguridad, config), anotala en `## Borde y transversales` para no repetir el analisis.
- `index.md`: `commit` (`git rev-parse --short HEAD`; sin commitear: `commit + dirty`).
- Si la feature cambio un flujo, integracion o convencion documentada en `docs/handoff/`, no edites el handoff: anotalo en `## Notas` del atlas ("handoff desactualizado en <seccion>") y mencionalo en una frase dentro del resumen del cierre, sugiriendo correr `midd-generate-handoff-docs` en modo actualizacion.

## Formato

`index.md` (max ~80 lineas):

```markdown
# Atlas
- commit: <hash>   escaneo: <completo | parcial>
- stack: <NestJS | Spring | ...>   build: <cmd>   test: <cmd>
- arquitectura: <estandar | legacy | mixto> - <evidencia en una linea>
- docs previas: <enlaces a ARCHITECTURE.md, inventarios, etc., si existen>
## Convenciones
- <reglas del proyecto y desvios de los estandares, una linea cada una>
## Borde y transversales
- <arranque: prefijo, versionado, middlewares/guards/filtros/pipes globales>
- <recursos compartidos: conexiones BD + tokens, config, logger, utilidades>
- <trampas de helpers compartidos; ultimo codigo de error usado>
## Patron de referencia
- <caso de uso ejemplar> -> <archivo>
## Modulos
- [<modulo>](./<modulo>.md): <proposito> (depende de: <otros>)
- sin detalle (<N>): <Nombre1, Nombre2, ... TODOS los nombres, separados por comas; solo si el escaneo es parcial (mas de ~100 modulos)>
## Puntos de entrada
- <ruta HTTP / cola / job> -> <archivo>
## Notas
- <deuda, brechas detectadas, linea base de build>
```

`<modulo>.md` (max ~60 lineas):

```markdown
# <modulo>
- ruta: <carpeta>   verificado: <hash>   arquitectura: <estandar | legacy> (solo si es mixto)
- proposito: <una linea>
## Simbolos clave
- <Clase.metodo | endpoint | puerto/adaptador> -> <archivo>
## Dependencias
- usa: <modulos>   usado por: <modulos>
## Notas
- <particularidades>
```

Si un archivo supera su limite, resume lo estable a una linea. En repos con muchos modulos (mas de ~15), el indice lleva los nombres en lista compacta (varios por linea) y sin detalle de puntos de entrada; ese detalle vive en cada `<modulo>.md`.

## Cierre

Usa exactamente esta plantilla, sin vinetas extra ni explicaciones adicionales (salvo que el usuario pida otro formato):

```
<Resumen: que hiciste, donde y que NO pudiste verificar. Maximo 3 lineas>
Arquitectura: <estandar | legacy | mixto> - <evidencia en una linea>
Decisiones: <las que tomaste por el usuario: ruta, verbo, publico/token... o "ninguna">
Existentes: <archivos existentes que modificaste, o "ninguno">
Atlas: <actualizado | creado> (<archivos>)
Medicion: <N> archivos de codigo leidos, <M> busquedas fuera del atlas. Faltaba: <nada | lo que descubriste fuera del atlas y ahora quedo anotado>
```

Separa cada linea de la plantilla con una linea en blanco (si no, el chat las junta en una sola). No agregues listas de "Cambios" ni vinetas: riesgos y brechas relevantes van dentro de las 3 lineas del resumen. Si el atlas no existia, en `Medicion` escribe `Faltaba: atlas (creado, escaneo completo | parcial)`.
