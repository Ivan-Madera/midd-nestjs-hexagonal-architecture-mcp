import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync
} from 'node:fs'
import { substitute, substitutePath, type PlaceholderMap } from './placeholders.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Raíz del dataset de plantillas (se empaqueta junto al MCP en `templates/`).
 * dist/lib/dataset.js -> ../../templates
 */
export const TEMPLATES_ROOT = resolve(__dirname, '..', '..', 'templates')

export function datasetPath(...segments: string[]): string {
  return join(TEMPLATES_ROOT, ...segments)
}

export function readTemplate(relativePath: string): string {
  const full = datasetPath(relativePath)
  if (!existsSync(full)) {
    throw new Error(`Plantilla no encontrada en el dataset: ${relativePath}`)
  }
  return readFileSync(full, 'utf8')
}

/** Lista recursiva de archivos (rutas relativas) bajo un subdir del dataset. */
export function listTemplateFiles(subdir: string): string[] {
  const root = datasetPath(subdir)
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full.substring(root.length + 1).replace(/\\/g, '/'))
    }
  }
  walk(root)
  return out
}

export type WriteResult = {
  written: string[]
  skipped: string[]
}

/**
 * Escribe un árbol de plantillas (subdir del dataset) en `destRoot`, aplicando
 * sustitución de placeholders al contenido Y a las rutas. Modo A: escribe disco.
 *
 * @param overwrite si false, no pisa archivos existentes (los reporta en skipped).
 * @param exclude   patrones (substring) de rutas de plantilla a excluir.
 */
export function materializeTree(opts: {
  subdir: string
  destRoot: string
  map: PlaceholderMap
  overwrite?: boolean
  exclude?: string[]
}): WriteResult {
  const { subdir, destRoot, map, overwrite = false, exclude = [] } = opts
  const files = listTemplateFiles(subdir)
  const written: string[] = []
  const skipped: string[] = []

  for (const rel of files) {
    if (exclude.some((p) => rel.includes(p))) continue

    const srcContent = readFileSync(datasetPath(subdir, rel), 'utf8')
    const outContent = substitute(srcContent, map)
    const outRel = substitutePath(rel, map)
    const outFull = join(destRoot, outRel)

    if (existsSync(outFull) && !overwrite) {
      skipped.push(outRel)
      continue
    }
    mkdirSync(dirname(outFull), { recursive: true })
    writeFileSync(outFull, outContent, 'utf8')
    written.push(outRel)
  }

  return { written, skipped }
}

/** Escribe un único archivo con sustitución. */
export function materializeFile(opts: {
  templateRelPath: string
  destFullPath: string
  map: PlaceholderMap
  overwrite?: boolean
}): WriteResult {
  const { templateRelPath, destFullPath, map, overwrite = false } = opts
  if (existsSync(destFullPath) && !overwrite) {
    return { written: [], skipped: [destFullPath] }
  }
  const content = substitute(readTemplate(templateRelPath), map)
  mkdirSync(dirname(destFullPath), { recursive: true })
  writeFileSync(destFullPath, content, 'utf8')
  return { written: [destFullPath], skipped: [] }
}
