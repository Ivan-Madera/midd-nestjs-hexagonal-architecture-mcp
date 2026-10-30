import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the shared configuration files of a generated service live.
 *
 * Services generated before the kebab-case standard have them as ConfigurationVariables.ts / joiSchema.ts.
 * New services have configuration-variables.ts / joi-schema.ts. A patcher asks here so it works on both:
 * the new name is the answer unless only the legacy file exists.
 */
const CONFIG_DIR = 'src/shared/infrastructure/config'

const FILES = {
  variables: { current: 'configuration-variables.ts', legacy: 'ConfigurationVariables.ts' },
  joi: { current: 'joi-schema.ts', legacy: 'joiSchema.ts' }
} as const

export type ConfigFileKind = keyof typeof FILES

/** Relative path (forward slashes) of a shared configuration file in the project. */
export function configFileRel(projectRoot: string, kind: ConfigFileKind): string {
  const { current, legacy } = FILES[kind]
  if (!existsSync(join(projectRoot, CONFIG_DIR, current)) && existsSync(join(projectRoot, CONFIG_DIR, legacy))) {
    return `${CONFIG_DIR}/${legacy}`
  }
  return `${CONFIG_DIR}/${current}`
}

/** Absolute path of a shared configuration file in the project. */
export const configFile = (projectRoot: string, kind: ConfigFileKind): string => join(projectRoot, configFileRel(projectRoot, kind))

/**
 * The layout of a domain written before the standard (infrastructure/infrastructure.<dom>.module.ts, camelCase files).
 * Returns the legacy file found, or undefined.
 */
export function legacyDomainLayout(projectRoot: string, domainFolderName: string): string | undefined {
  const root = join(projectRoot, 'src', domainFolderName)
  const candidates = [`infrastructure/infrastructure.${domainFolderName}.module.ts`]
  return candidates.find((rel) => existsSync(join(root, rel)))
}
