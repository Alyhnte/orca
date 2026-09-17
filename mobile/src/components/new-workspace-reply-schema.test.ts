import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  codexResetCapabilityListSchema,
  codexResetCreditReplySchema
} from './codex-reset-credit-reply-schema'
import {
  newWorkspaceRepoHooksSchema,
  newWorkspaceUiTrustSchema
} from './new-workspace-reply-schema'

function reads<T>(schema: z.ZodType<T, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`expected a readable reply: ${parsed.error.message}`)
  }
  return parsed.data
}

function refuses(schema: z.ZodType<unknown, unknown>, value: unknown): boolean {
  return !schema.safeParse(value).success
}

describe('the drawer requires only what it reads unguarded', () => {
  it('requires the hook source the drawer assigns straight into its details', () => {
    const reply = { hooks: { scripts: { setup: 'pnpm i' } }, source: 'repo', setupTrust: null }
    expect(reads(newWorkspaceRepoHooksSchema, reply).source).toBe('repo')
    expect(refuses(newWorkspaceRepoHooksSchema, { hooks: null })).toBe(true)
    expect(refuses(newWorkspaceRepoHooksSchema, { error: 'refused' })).toBe(true)
    expect(refuses(newWorkspaceRepoHooksSchema, null)).toBe(true)
  })

  it('preserves an explicit null source rather than collapsing it to absent', () => {
    expect(reads(newWorkspaceRepoHooksSchema, { hooks: null, source: null }).source).toBe(null)
  })

  it('takes the recorded reply with an explicit null setupTrust without salvaging it', () => {
    // The components-setup-ask fixture sends `setupTrust: null`; treating that as a malformed
    // member would report a drop on a reply the host really sends.
    const reply = { hooks: null, source: null, setupRunPolicy: 'ask', setupTrust: null }
    expect(reads(newWorkspaceRepoHooksSchema, reply).setupTrust).toBe(null)
  })

  it('drops a setupTrust missing the members normalizeSetupHookTrust reads', () => {
    const reply = { source: null, setupTrust: { contentHash: 7, scriptContent: 'x' } }
    expect(reads(newWorkspaceRepoHooksSchema, reply).setupTrust).toBe(undefined)
  })
})

describe('the setup run policy is a closed enum with the call site defaulting it', () => {
  it('keeps each arm the drawer compares against', () => {
    for (const policy of ['ask', 'run-by-default', 'skip-by-default'] as const) {
      expect(
        reads(newWorkspaceRepoHooksSchema, { source: null, setupRunPolicy: policy }).setupRunPolicy
      ).toBe(policy)
    }
  })

  it('drops an arm this build does not know, which behaves as run-by-default did', () => {
    expect(
      reads(newWorkspaceRepoHooksSchema, { source: null, setupRunPolicy: 'on-tuesdays' })
        .setupRunPolicy
    ).toBe(undefined)
  })
})

describe('the trust record salvages per repo', () => {
  it('keeps the approvals isSetupHookTrusted reads', () => {
    const ui = { trustedOrcaHooks: { 'repo-1': { setup: { contentHash: 'h', approvedAt: 1 } } } }
    expect(reads(newWorkspaceUiTrustSchema, { ui })?.trustedOrcaHooks?.['repo-1']?.setup).toEqual({
      contentHash: 'h',
      approvedAt: 1
    })
  })

  it('drops one unreadable repo without costing the others their trust', () => {
    const ui = {
      trustedOrcaHooks: {
        'repo-1': { all: { approvedAt: 1 } },
        'repo-2': 'not-a-record'
      }
    }
    const trust = reads(newWorkspaceUiTrustSchema, { ui })?.trustedOrcaHooks
    expect(trust?.['repo-1']?.all).toEqual({ approvedAt: 1 })
    expect(trust?.['repo-2']).toBe(undefined)
  })

  it('reads a null or absent ui the way the drawer always has', () => {
    expect(reads(newWorkspaceUiTrustSchema, null)).toBe(undefined)
    expect(reads(newWorkspaceUiTrustSchema, {})).toBe(undefined)
    expect(reads(newWorkspaceUiTrustSchema, { ui: null })).toBe(null)
  })
})

describe('the two codex reset replies', () => {
  it('drops a capability list carrying a non-string, whole, as main did', () => {
    expect(reads(codexResetCapabilityListSchema, { capabilities: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(reads(codexResetCapabilityListSchema, { capabilities: ['a', 7] })).toBe(undefined)
    expect(reads(codexResetCapabilityListSchema, {})).toBe(undefined)
  })

  it('forwards the redeem reply whole to decodeResetResult', () => {
    expect(refuses(codexResetCreditReplySchema, null)).toBe(false)
    expect(refuses(codexResetCreditReplySchema, { outcome: 'reset' })).toBe(false)
  })
})
