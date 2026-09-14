import { tokenizeStartupCommand, type AgentStartupShell } from './tui-agent-startup-shell'

export const ORCA_OMP_FRESH_CONFIG_ENV = 'ORCA_OMP_FRESH_CONFIG'
export const OMP_FRESH_CONFIG_FILENAME = 'fresh-session.yml'
export const OMP_FRESH_CONFIG_SOURCE = 'autoResume: false\n'

// Unknown flags may consume values or select a subcommand; leave those commands intact.
const VALUE_FLAGS = new Set([
  '--model',
  '--provider',
  '--thinking',
  '--config',
  '--profile',
  '--extension',
  '-e',
  '--system-prompt',
  '--append-system-prompt',
  '--tools',
  '--skill',
  '--theme',
  '--api-key'
])
const SWITCH_FLAGS = new Set(['--no-extensions', '--no-skills', '--no-prompt-templates'])

/** Apply fresh intent to one launch command, never the saved resume configuration. */
export function withFreshOmpLaunch(command: string, shell: AgentStartupShell): string {
  const parsed = tokenizeStartupCommand(command, shell)
  if (!parsed.ok) {
    return command
  }
  const executable = parsed.tokens[0]?.split(/[\\/]/).at(-1)?.toLowerCase()
  if (!['omp', 'omp.exe', 'omp.cmd', 'omp.bat', 'omp.sh', 'omp.js'].includes(executable ?? '')) {
    return command
  }
  let index = parsed.tokens[1] === 'launch' ? 2 : 1
  for (; index < parsed.tokens.length; index++) {
    const token = parsed.tokens[index]
    const equals = token.indexOf('=')
    const flag = equals === -1 ? token : token.slice(0, equals)
    if (VALUE_FLAGS.has(flag)) {
      if (equals === -1 && ++index >= parsed.tokens.length) {
        return command
      }
    } else if (!SWITCH_FLAGS.has(token)) {
      return command
    }
  }
  const path =
    shell === 'cmd'
      ? `"%${ORCA_OMP_FRESH_CONFIG_ENV}%"`
      : shell === 'powershell'
        ? `"$env:${ORCA_OMP_FRESH_CONFIG_ENV}"`
        : `"$${ORCA_OMP_FRESH_CONFIG_ENV}"`
  return `${command} --config ${path}`
}
