/**
 * Host-side delivery of a launch's initial text to the structured session the launch just created.
 *
 * It exists so a caller does not have to implement delivery itself. Before this, `agent.launch`
 * created the surface and reported the text as undelivered, which was only workable while the one
 * surface that could send — the desktop renderer's chat — was also the one issuing the launch.
 * Mobile and anything else calling `agent.launch` got an agent and no prompt.
 *
 * Nothing here queues. The durable record that the text is owed already exists and is the journal's
 * own submission row: `performSend` appends it before dispatching and the attach path settles it, so
 * a second host-side copy could only disagree with it. What IS reused is the outbox's entry and
 * envelope builders, so this send is shaped exactly like the renderer's and mobile's — same body,
 * same operation id as client message id, same payload fingerprint.
 *
 * The renderer still delivers its own launch prompts, because its launcher does not call
 * `agent.launch` yet; when it does, its launch-sourced outbox entries become this call.
 */

import {
  createStructuredAgentSessionOutboxEntry,
  structuredAgentSessionSendMutation
} from '../../../../shared/structured-agent-session-outbox'
import { createStructuredAgentSessionOperationId } from '../../../../shared/structured-agent-session-mutation'
import { randomUUID } from 'node:crypto'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import type { StructuredAgentSessionCaller } from '../../../native-chat/agent-session-wire/structured-agent-session-host-types'

/**
 * The committed transcript row's id, or `null` when nothing was committed.
 *
 * `ok` is the host's own proof of the commit: `performSend` refuses when the append fails and
 * never refuses after it, so a truthy result cannot name a row that does not exist. Every other
 * answer — a refusal, a missing host, a throw — is `null`, and the launch reports the text as still
 * the caller's. A resend costs a duplicate message; over-claiming loses the text with no trace.
 *
 * Deliberately does NOT wait for the dispatch to settle. The row is committed either way, and
 * whether the provider took the turn is the submission's own state to carry.
 */
export async function commitStructuredAgentSessionLaunchPrompt(args: {
  host: StructuredAgentSessionHost | null
  caller: StructuredAgentSessionCaller
  sessionId: string
  fence: number
  text: string
}): Promise<string | null> {
  if (!args.host || args.text.trim().length === 0) {
    return null
  }
  const entry = createStructuredAgentSessionOutboxEntry({
    clientMessageId: createStructuredAgentSessionOperationId(randomUUID),
    sessionId: args.sessionId,
    text: args.text,
    attachments: [],
    queuedAt: Date.now()
  })
  try {
    const result = await args.host.send(
      args.caller,
      structuredAgentSessionSendMutation(entry, args.fence)
    )
    return result.ok ? result.value.clientMessageId : null
  } catch (error) {
    // A launch whose agent is already running must not fail over its prompt; the caller can resend.
    console.warn('[agent-launch] the session was created, its launch prompt was not sent', error)
    return null
  }
}
