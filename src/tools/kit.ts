import { existsSync } from 'node:fs'
import { autoKitEnabled, ensureAgenticKit, type KitEnsureResult } from '../lib/agenticKit.js'

/**
 * Automatic installation of the agentic kit.
 *
 * The MCP is configured once for the whole user, so at start-up it does not know which repo is open. It knows it the
 * moment a tool receives a `projectRoot`: that is when the kit is checked and, if it is not there, installed. The
 * user never has to ask for it, and the answer of the tool tells them which agent to select.
 *
 * What an MCP cannot do is switch the agent of the chat: Kiro keeps that choice in its own selector (the chat input
 * bar). So the notice says how to select it instead of pretending to do it.
 */
const AGENT = 'middleware-generator'

const PICK_THE_AGENT = [
  `PARA EL USUARIO: este chat sigue con el agente por defecto de Kiro, que no conoce el flujo del MCP. Abre el selector de agentes`,
  `(en la barra de entrada del chat, junto al selector de modelo), elige \`${AGENT}\` y repite tu pedido ahi. Aparece en el selector`,
  `al guardarse el archivo; si no lo ves, recarga la ventana de Kiro. Un MCP no puede cambiar el agente por ti. Segun el changelog de`,
  `Kiro IDE 1.0 ese mismo selector permite dejar un agente preferido que persiste entre reinicios, si quieres que arranque siempre con el.`,
  `PARA EL AGENTE: si no eres \`${AGENT}\`, dile esto al usuario antes de seguir y continua solo si el te lo confirma.`
]

const gateNotice = (projectRoot: string): string =>
  [
    `KIT DEL MCP INSTALADO automaticamente en ${projectRoot}. TODAVIA NO GENERE NADA.`,
    `Este chat sigue con el agente por defecto de Kiro, que no conoce el flujo del MCP ni las preguntas que hace`,
    `(prefijo de la API, base de datos, autorizacion, casos de uso...). Generar desde aqui se saltaria todo eso.`,
    ...PICK_THE_AGENT.slice(0, -1),
    'PARA EL AGENTE: no llames otra vez esta herramienta ni sigas generando en este chat. Explicale esto al usuario y espera a que cambie de agente.'
  ].join('\n')

export function kitNotice(result: KitEnsureResult, projectRoot: string, entry: boolean): string | undefined {
  switch (result.state) {
    case 'installed':
    case 'updated':
      return [
        `KIT DEL MCP ${result.state === 'installed' ? 'INSTALADO' : 'ACTUALIZADO'} automaticamente en ${projectRoot}:`,
        '  - .kiro/agents/middleware-generator.md, middleware-gen-worker.md y middleware-auditor.md',
        '  - agentic/templates/middleware.spec.template.yaml y la seccion del MCP en AGENTS.md',
        ...PICK_THE_AGENT
      ].join('\n')
    case 'present':
      return entry
        ? `Kit del MCP ya instalado en este repo. Para este flujo usa el agente \`${AGENT}\` (selector de agentes del chat); si no lo ves, recarga la ventana de Kiro.`
        : undefined
    case 'foreign':
      return [
        `KIT DEL MCP NO instalado: ya hay agentes en .kiro/agents con esos nombres que no instalo este MCP (${result.files.map((f) => f.path).join(', ')}).`,
        'Los tres agentes trabajan como un conjunto y no se mezclan con los de otro kit. Para reemplazarlos como conjunto usa',
        'install_agentic_kit con overwrite=true, o quita el otro kit primero.'
      ].join('\n')
    case 'failed':
      return `KIT DEL MCP: no pude instalarlo automaticamente (${result.detail}). Corre la herramienta install_agentic_kit para ver el motivo.`
  }
}

/**
 * Runs the kit check BEFORE the tool (so the kit exists even if the tool then fails) and appends the notice AFTER it.
 * `creates`: the tool may be given a folder that does not exist yet (a new service). Any other tool skips a
 * `projectRoot` that is not there, so a typo never creates a stray folder.
 * `entry`: the tool opens a flow, so it also reminds which agent to use when the kit was already installed.
 * `skip`: a call that must not write anything (a dry run) installs nothing.
 */
export function withKit<A extends { projectRoot?: string }, R extends { content: Array<{ type: 'text'; text: string }> }>(
  options: { creates?: boolean; entry?: boolean; skip?: (args: A) => boolean; gate?: boolean },
  handler: (args: A) => Promise<R>
): (args: A) => Promise<R> {
  return async (args: A) => {
    const root = args.projectRoot
    const skipped = options.skip?.(args) === true
    const ensured = !skipped && autoKitEnabled() && root && (options.creates || existsSync(root)) ? ensureAgenticKit(root) : undefined
    // First contact: the kit has just been installed and this chat is still on the default agent, which does not know
    // the flow or its questions. A tool that generates does NOT run now; the user is told to pick the agent first.
    if (options.gate && ensured?.state === 'installed' && root) {
      return { content: [{ type: 'text' as const, text: gateNotice(root) }] } as unknown as R
    }
    const result = await handler(args)
    const note = ensured && root ? kitNotice(ensured, root, options.entry === true) : undefined
    if (note) result.content.push({ type: 'text' as const, text: note })
    return result
  }
}
