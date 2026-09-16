import {
  clearEnvCommand,
  commandSeparator,
  quoteStartupArg,
  type AgentStartupShell
} from './tui-agent-startup-shell'

const FUNCTION_NAME = '__orca_omp_draft'
export const OMP_DRAFT_LAUNCH_PREFIX = `command test -n "$fish_pid" && eval 'function ${FUNCTION_NAME}; `

/** Clear the calling shell's prefill without replacing the agent's exit status. */
export function withOmpDraftCleanup(command: string, shell: AgentStartupShell): string {
  if (shell !== 'posix') {
    // cmd otherwise binds the cleanup to the guard's else branch.
    const launch = shell === 'cmd' ? `( ${command} )` : command
    return `${launch}${commandSeparator(shell)}${clearEnvCommand('ORCA_OMP_PREFILL', shell)}`
  }
  const fish = `function ${FUNCTION_NAME}; ${command}; set -l __orca_status $status; set -e -g ORCA_OMP_PREFILL; return $__orca_status; end`
  const posix = `${FUNCTION_NAME}() { ${command}; set -- "$?"; unset ORCA_OMP_PREFILL; return "$1"; }`
  // Quote each dialect until eval selects it; fish cannot parse the sh function body.
  return `command test -n "$fish_pid" && eval ${quoteStartupArg(fish, 'posix')}; command test -z "$fish_pid" && eval ${quoteStartupArg(posix, 'posix')}; ${FUNCTION_NAME}`
}
