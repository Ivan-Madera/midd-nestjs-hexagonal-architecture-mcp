/** Is the automatic installation of the agentic kit on? `MIDD_NESTJS_AUTO_KIT=off` (or 0 / false / no) turns it off. */
export function autoKitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|0|false|no)$/i.test((env.MIDD_NESTJS_AUTO_KIT ?? '').trim())
}
