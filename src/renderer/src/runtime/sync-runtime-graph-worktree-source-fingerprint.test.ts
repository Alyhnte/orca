import { beforeEach, describe, expect, it } from 'vitest'
import { canReuseMobileSessionSnapshot } from './sync-runtime-graph/mobile-session-capture'
import { buildMobileSessionWorktreeInputs } from './sync-runtime-graph/mobile-session-inputs'
import {
  collectMobileSessionWorktreeSourceRefs,
  mobileSessionWorktreeSourceRefsEqual
} from './sync-runtime-graph/mobile-session-worktree-sources'
import {
  DIRTY_WT,
  gateSideOf,
  makeGateState,
  resetPublicationCaches,
  type GateSide
} from './sync-runtime-graph-worktree-source-gate.test-support'
import { mutations } from './sync-runtime-graph-worktree-source-mutations.test-support'

/**
 * The gate's whole contract: equal source refs must imply the rebuild it skipped would have been a
 * no-op. Published content is the weaker oracle — a mutation the fingerprint misses can still land
 * on identical output in one fixture — so assert the invariant against `canReuseMobileSessionSnapshot`
 * itself.
 */

beforeEach(() => {
  resetPublicationCaches()
})

function inputsOf(side: GateSide): ReturnType<typeof buildMobileSessionWorktreeInputs> {
  return buildMobileSessionWorktreeInputs(
    side.state,
    DIRTY_WT,
    side.publication,
    side.owners.ambiguousTabIds
  )
}

function refsOf(side: GateSide): ReturnType<typeof collectMobileSessionWorktreeSourceRefs> {
  return collectMobileSessionWorktreeSourceRefs(side.state, DIRTY_WT, side.publication, side.owners)
}

describe('equal source refs imply the skipped rebuild would have been reusable', () => {
  for (const mutation of mutations) {
    it(`distinguishes ${mutation.name} from an unchanged frame`, () => {
      const { state } = makeGateState(4)
      const base = gateSideOf(state)
      const mutated = gateSideOf(mutation.apply(state))

      expect(canReuseMobileSessionSnapshot(inputsOf(base), inputsOf(mutated))).toBe(false)
      expect(mobileSessionWorktreeSourceRefsEqual(refsOf(base), refsOf(mutated))).toBe(false)
    })
  }

  /**
   * Not reachable from a store edit: flipping `tabAutoGenerateTitle` replaces `state.settings`,
   * which also hands `getMobileTerminalTheme` a new object, so `terminalTheme` always moves with it
   * and would mask this field's deletion. Drive the publication inputs directly instead — they are
   * what the collector actually consumes.
   */
  it('distinguishes the generated-title flag with the terminal theme held fixed', () => {
    const { state } = makeGateState(4)
    const base = gateSideOf(state)
    const withGeneratedTitles: GateSide = {
      ...base,
      publication: { ...base.publication, generatedTitlesEnabled: true }
    }

    expect(base.publication.terminalTheme).toBe(withGeneratedTitles.publication.terminalTheme)
    expect(canReuseMobileSessionSnapshot(inputsOf(base), inputsOf(withGeneratedTitles))).toBe(false)
    expect(mobileSessionWorktreeSourceRefsEqual(refsOf(base), refsOf(withGeneratedTitles))).toBe(
      false
    )
  })
})
