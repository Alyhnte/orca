import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../shared/terminal-tab-types'
import type { AppState } from '../store/types'
import {
  buildMobileSessionTabSnapshots,
  registerRuntimeTerminalTab,
  resetRuntimeMobileSyncProjectionCachesForTests
} from './sync-runtime-graph'
import {
  getTerminalTabOwnershipIndex,
  graphState,
  resetRuntimeGraphSliceScanCaches
} from './sync-runtime-graph/graph-state'
import {
  buildMobileSessionAgentStatusByWorktree,
  buildMobileSessionWorktreeInputs,
  getOpenFileIndexes
} from './sync-runtime-graph/mobile-session-inputs'
import {
  collectMobileSessionWorktreeIds,
  collectMobileSessionWorktreeSourceRefs,
  mobileSessionWorktreeSourceRefsEqual,
  resetMobileSessionWorktreeIdCacheForTests
} from './sync-runtime-graph/mobile-session-worktree-sources'
import { canReuseMobileSessionSnapshot } from './sync-runtime-graph/mobile-session-capture'
import { createTabKeyedRecordPartitioner } from './sync-runtime-graph/tab-keyed-record-partition'
import { getEditorDraftVersionByFileId } from './sync-runtime-graph/sync-projections'
import { getMobileTerminalTheme } from './sync-runtime-graph/mobile-terminal-theme'
import type { MobileSessionPublicationInputs } from './sync-runtime-graph/types'

/**
 * Why operation counts and not wall clock: the gate exists so a publication costs what the frame
 * changed rather than what the session accumulated. A millisecond threshold would track the test
 * machine; asserting that the work does not grow with the worktree count does not.
 */

const LEAF_ID = 'eeeeeeee-1111-4111-8111-111111111111'
const DIRTY_WT = 'repo::/gate-dirty'
const MOUNTED_WT = 'repo::/gate-mounted'

function makeTab(id: string, worktreeId: string, title = 'Agent'): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeStatusEntry(paneKey: string, state: AgentStatusEntry['state']): AgentStatusEntry {
  return { state, prompt: '', updatedAt: 1, stateStartedAt: 1, paneKey, stateHistory: [] }
}

function makeLayout(ptyId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: LEAF_ID },
    activeLeafId: LEAF_ID,
    expandedLeafId: null,
    ptyIdsByLeafId: { [LEAF_ID]: ptyId }
  }
}

/** `tab.id` is read only while a builder walks a worktree's tabs, so its reads count rebuilds. */
function makeGateState(filler: number): {
  state: AppState
  tabIdReads: () => number
  resetTabIdReads: () => void
} {
  let tabIdReads = 0
  const countingTab = (id: string, worktreeId: string, title?: string): TerminalTab => ({
    ...makeTab(id, worktreeId, title),
    get id() {
      tabIdReads += 1
      return id
    }
  })
  const tabsByWorktree: Record<string, TerminalTab[]> = {
    // The second tab has no layout, pane title or draft, so only the ambiguity set can witness a
    // change of its ownership.
    [DIRTY_WT]: [countingTab('gate-dirty-term', DIRTY_WT), countingTab('gate-bare-term', DIRTY_WT)]
  }
  const terminalLayoutsByTabId: AppState['terminalLayoutsByTabId'] = {
    'gate-dirty-term': makeLayout('pty-gate-dirty')
  }
  for (let index = 0; index < filler; index += 1) {
    const worktreeId = `repo::/gate-filler-${index}`
    tabsByWorktree[worktreeId] = [countingTab(`gate-filler-term-${index}`, worktreeId)]
    terminalLayoutsByTabId[`gate-filler-term-${index}`] = makeLayout(`pty-gate-filler-${index}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the publication path reads only the slices assigned here; a full AppState is not constructible in a unit test.
  const state = {
    tabsByWorktree,
    terminalLayoutsByTabId,
    runtimePaneTitlesByTabId: {},
    nativeChatLaunchDraftByTabId: {},
    groupsByWorktree: {},
    activeGroupIdByWorktree: {},
    layoutByWorktree: {},
    unifiedTabsByWorktree: {},
    tabBarOrderByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeTabType: null,
    activeTabTypeByWorktree: {},
    activeBrowserTabIdByWorktree: {},
    openFiles: [],
    editorDrafts: {},
    activeTabId: null,
    agentStatusByPaneKey: {
      [`gate-dirty-term:${LEAF_ID}`]: makeStatusEntry(`gate-dirty-term:${LEAF_ID}`, 'working')
    },
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {},
    browserCertificateFailuresByPageId: {},
    worktreesByRepo: {},
    folderWorkspaces: [],
    settings: { tabAutoGenerateTitle: false }
  } as unknown as AppState
  return {
    state,
    tabIdReads: () => tabIdReads,
    resetTabIdReads: () => {
      tabIdReads = 0
    }
  }
}

/** Every mutation below replaces slices of the same partial fixture; see `makeGateState`. */
function patchGateState(state: AppState, patch: Partial<AppState>): AppState {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a patch of the partial fixture is the same shape, and the publication path reads only the slices it assigns.
  return { ...state, ...patch } as AppState
}

function withChangedStatus(state: AppState, nextState: AgentStatusEntry['state']): AppState {
  const paneKey = `gate-dirty-term:${LEAF_ID}`
  return patchGateState(state, {
    agentStatusByPaneKey: { [paneKey]: makeStatusEntry(paneKey, nextState) }
  })
}

function resetPublicationCaches(): void {
  graphState.mobileSessionSnapshotCacheByWorktree.clear()
  graphState.publishedMobileSessionSnapshotByWorktree.clear()
  resetRuntimeGraphSliceScanCaches()
  resetRuntimeMobileSyncProjectionCachesForTests()
  resetMobileSessionWorktreeIdCacheForTests()
}

/** `snapshotVersion` counts rebuilds, so it must not be part of a content comparison. */
function contentOf(snapshots: ReturnType<typeof buildMobileSessionTabSnapshots>): unknown {
  return snapshots.map(({ snapshotVersion: _version, ...rest }) => rest)
}

beforeEach(() => {
  resetPublicationCaches()
})

/**
 * One cache write per worktree the publication actually rebuilt: the gated path reuses the cached
 * snapshot and writes nothing, so this counts exactly what the frame failed to skip.
 */
function rebuiltWorktreesPerFrame(mutate: (state: AppState) => AppState): number[] {
  return [20, 400].map((filler) => {
    resetPublicationCaches()
    const { state } = makeGateState(filler)
    buildMobileSessionTabSnapshots(state, false)
    const writes = vi.spyOn(graphState.mobileSessionSnapshotCacheByWorktree, 'set')
    try {
      buildMobileSessionTabSnapshots(mutate(state), false)
      return writes.mock.calls.length
    } finally {
      writes.mockRestore()
    }
  })
}

describe('mobile session publication skips worktrees the frame did not touch', () => {
  it('rebuilds one worktree on a status frame at either scale', () => {
    expect(rebuiltWorktreesPerFrame((state) => withChangedStatus(state, 'waiting'))).toEqual([1, 1])
  })

  // An OSC title frame replaces `tabsByWorktree`, so the ambiguity set must keep its identity when
  // ownership did not move; otherwise every worktree looks dirty on every title tick.
  it('rebuilds one worktree on a tab-title frame at either scale', () => {
    expect(
      rebuiltWorktreesPerFrame((state) => ({
        ...state,
        tabsByWorktree: {
          ...state.tabsByWorktree,
          [DIRTY_WT]: [makeTab('gate-dirty-term', DIRTY_WT, 'Renamed')]
        }
      }))
    ).toEqual([1, 1])
  })

  it('still republishes the worktree whose status changed', () => {
    const { state } = makeGateState(20)
    const statusOf = (snapshots: ReturnType<typeof buildMobileSessionTabSnapshots>): unknown => {
      const tab = snapshots.find((snapshot) => snapshot.worktree === DIRTY_WT)?.tabs[0]
      return tab?.type === 'terminal' ? tab.agentStatus?.state : undefined
    }

    expect(statusOf(buildMobileSessionTabSnapshots(state, false))).toBe('working')
    expect(
      statusOf(buildMobileSessionTabSnapshots(withChangedStatus(state, 'waiting'), false))
    ).toBe('waiting')
  })
})

describe('the gate reads every store value the inputs builder reads', () => {
  it('records no AppState key the source-ref collector misses', () => {
    const { state } = makeGateState(2)
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    const publication: MobileSessionPublicationInputs = {
      browserTabsByWorktree: state.browserTabsByWorktree ?? {},
      openFileIndexes: getOpenFileIndexes(state.openFiles),
      editorDraftVersionByFileId: getEditorDraftVersionByFileId(state.editorDrafts),
      agentStatusByWorktreeId: buildMobileSessionAgentStatusByWorktree(
        state.agentStatusByPaneKey,
        state.tabsByWorktree
      ),
      terminalLayoutByWorktree: createTabKeyedRecordPartitioner<
        AppState['terminalLayoutsByTabId'][string]
      >()(state.terminalLayoutsByTabId, owners),
      runtimePaneTitleByWorktree: createTabKeyedRecordPartitioner<
        AppState['runtimePaneTitlesByTabId'][string]
      >()(state.runtimePaneTitlesByTabId, owners),
      launchDraftByWorktree: createTabKeyedRecordPartitioner<
        NonNullable<AppState['nativeChatLaunchDraftByTabId']>[string]
      >()(state.nativeChatLaunchDraftByTabId, owners),
      generatedTitlesEnabled: false,
      terminalTheme: getMobileTerminalTheme(state, false)
    }
    const recordKeyReads = (run: (observed: AppState) => void): Set<string> => {
      const reads = new Set<string>()
      run(
        new Proxy(state, {
          get: (target, key) => {
            if (typeof key === 'string') {
              reads.add(key)
            }
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the proxy target is this fixture's AppState, so every key it is asked for indexes it.
            return target[key as keyof AppState]
          }
        })
      )
      return reads
    }

    const builderReads = recordKeyReads((observed) => {
      buildMobileSessionWorktreeInputs(observed, DIRTY_WT, publication, owners.ambiguousTabIds)
    })
    const collectorReads = recordKeyReads((observed) => {
      collectMobileSessionWorktreeSourceRefs(observed, DIRTY_WT, publication, owners)
    })

    expect([...builderReads].filter((key) => !collectorReads.has(key))).toEqual([])
    expect(builderReads.size).toBeGreaterThan(5)
  })
})

const mutations: { name: string; apply: (state: AppState) => AppState }[] = [
  {
    name: 'a terminal tab title',
    apply: (state) => ({
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        [DIRTY_WT]: [makeTab('gate-dirty-term', DIRTY_WT, 'Renamed')]
      }
    })
  },
  { name: 'an agent status', apply: (state) => withChangedStatus(state, 'waiting') },
  {
    name: 'a runtime pane title',
    apply: (state) => ({
      ...state,
      runtimePaneTitlesByTabId: { 'gate-dirty-term': { 1: 'vim' } }
    })
  },
  {
    name: 'a saved terminal layout',
    apply: (state) =>
      patchGateState(state, {
        terminalLayoutsByTabId: { 'gate-dirty-term': makeLayout('pty-gate-relayout') }
      })
  },
  {
    name: 'the active tab',
    apply: (state) => ({ ...state, activeTabId: 'gate-dirty-term' })
  },
  {
    name: 'a tab group',
    apply: (state) => ({
      ...state,
      groupsByWorktree: {
        ...state.groupsByWorktree,
        [DIRTY_WT]: [
          {
            id: 'gate-group',
            worktreeId: DIRTY_WT,
            activeTabId: 'gate-dirty-term',
            tabOrder: ['gate-dirty-term']
          }
        ]
      },
      activeGroupIdByWorktree: { ...state.activeGroupIdByWorktree, [DIRTY_WT]: 'gate-group' }
    })
  },
  {
    name: 'the generated-title setting',
    apply: (state) =>
      patchGateState(state, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture's settings object is a partial one; only `tabAutoGenerateTitle` is read here.
        settings: { ...state.settings, tabAutoGenerateTitle: true } as AppState['settings']
      })
  },
  {
    name: 'another worktree claiming a tab with no tab-keyed records',
    apply: (state) => ({
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        'repo::/gate-bare-claimant': [makeTab('gate-bare-term', 'repo::/gate-bare-claimant')]
      }
    })
  },
  {
    name: 'an open file',
    apply: (state) =>
      patchGateState(state, {
        openFiles: [
          {
            id: '/gate/readme.md',
            filePath: '/gate/readme.md',
            relativePath: 'readme.md',
            worktreeId: DIRTY_WT,
            language: 'markdown',
            isDirty: false,
            mode: 'edit'
          }
        ]
      })
  },
  {
    name: 'another worktree claiming this tab id',
    apply: (state) => ({
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        'repo::/gate-claimant': [makeTab('gate-dirty-term', 'repo::/gate-claimant')]
      }
    })
  },
  {
    name: 'the worktree that owns a tab',
    apply: (state) => ({
      ...state,
      tabsByWorktree: {
        ...state.tabsByWorktree,
        [DIRTY_WT]: [],
        'repo::/gate-filler-0': [
          makeTab('gate-filler-term-0', 'repo::/gate-filler-0'),
          makeTab('gate-dirty-term', 'repo::/gate-filler-0')
        ]
      }
    })
  }
]

describe('the gate never publishes a stale worktree', () => {
  for (const mutation of mutations) {
    it(`publishes what a cold rebuild would after ${mutation.name} changes`, () => {
      const { state } = makeGateState(12)
      buildMobileSessionTabSnapshots(state, false)
      const mutated = mutation.apply(state)

      const gated = contentOf(buildMobileSessionTabSnapshots(mutated, false))
      graphState.mobileSessionSnapshotCacheByWorktree.clear()
      const cold = contentOf(buildMobileSessionTabSnapshots(mutated, false))

      expect(gated).toEqual(cold)
    })
  }
})

/**
 * The gate's whole contract: equal source refs must imply the rebuild it skipped would have been a
 * no-op. Published content is the weaker oracle — a mutation the fingerprint misses can still land
 * on identical output in one fixture — so assert the invariant against `canReuseMobileSessionSnapshot`
 * itself.
 */
describe('equal source refs imply the skipped rebuild would have been reusable', () => {
  const partitionLayouts =
    createTabKeyedRecordPartitioner<AppState['terminalLayoutsByTabId'][string]>()
  const partitionTitles =
    createTabKeyedRecordPartitioner<AppState['runtimePaneTitlesByTabId'][string]>()
  const partitionDrafts =
    createTabKeyedRecordPartitioner<NonNullable<AppState['nativeChatLaunchDraftByTabId']>[string]>()

  function sideOf(state: AppState): {
    state: AppState
    owners: ReturnType<typeof getTerminalTabOwnershipIndex>
    publication: MobileSessionPublicationInputs
  } {
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    return {
      state,
      owners,
      publication: {
        browserTabsByWorktree: state.browserTabsByWorktree ?? {},
        openFileIndexes: getOpenFileIndexes(state.openFiles),
        editorDraftVersionByFileId: getEditorDraftVersionByFileId(state.editorDrafts),
        agentStatusByWorktreeId: buildMobileSessionAgentStatusByWorktree(
          state.agentStatusByPaneKey,
          state.tabsByWorktree
        ),
        terminalLayoutByWorktree: partitionLayouts(state.terminalLayoutsByTabId, owners),
        runtimePaneTitleByWorktree: partitionTitles(state.runtimePaneTitlesByTabId, owners),
        launchDraftByWorktree: partitionDrafts(state.nativeChatLaunchDraftByTabId, owners),
        generatedTitlesEnabled: state.settings?.tabAutoGenerateTitle === true,
        terminalTheme: getMobileTerminalTheme(state, false)
      }
    }
  }

  for (const mutation of mutations) {
    it(`distinguishes ${mutation.name} from an unchanged frame`, () => {
      const { state } = makeGateState(4)
      const base = sideOf(state)
      const mutated = sideOf(mutation.apply(state))
      const inputsOf = (
        side: ReturnType<typeof sideOf>
      ): ReturnType<typeof buildMobileSessionWorktreeInputs> =>
        buildMobileSessionWorktreeInputs(
          side.state,
          DIRTY_WT,
          side.publication,
          side.owners.ambiguousTabIds
        )
      const refsOf = (
        side: ReturnType<typeof sideOf>
      ): ReturnType<typeof collectMobileSessionWorktreeSourceRefs> =>
        collectMobileSessionWorktreeSourceRefs(side.state, DIRTY_WT, side.publication, side.owners)

      expect(canReuseMobileSessionSnapshot(inputsOf(base), inputsOf(mutated))).toBe(false)
      expect(mobileSessionWorktreeSourceRefsEqual(refsOf(base), refsOf(mutated))).toBe(false)
    })
  }
})

describe('a mounted worktree is never gated on store references alone', () => {
  it('republishes when only the live PaneManager moved', () => {
    const panes = [
      { id: 1, leafId: LEAF_ID },
      { id: 2, leafId: 'ffffffff-1111-4111-8111-111111111111' }
    ]
    let activeIndex = 0
    const manager = {
      getPanes: () => panes.map((pane) => ({ ...pane })),
      getActivePane: () => panes[activeIndex] ?? null,
      getLeafId: (paneId: number) => panes.find((pane) => pane.id === paneId)?.leafId ?? null,
      getNumericIdForLeaf: (leafId: string) =>
        panes.find((pane) => pane.leafId === leafId)?.id ?? null
    }
    const { state } = makeGateState(12)
    const mountedState = patchGateState(state, {
      tabsByWorktree: {
        ...state.tabsByWorktree,
        [MOUNTED_WT]: [makeTab('gate-mounted-term', MOUNTED_WT)]
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the publication path calls only the PaneManager members stubbed above.
    const unregister = registerRuntimeTerminalTab({
      tabId: 'gate-mounted-term',
      worktreeId: MOUNTED_WT,
      getManager: () => manager,
      getContainer: () => null,
      getPtyIdForPane: (paneId: number) => `pty-gate-${paneId}`,
      getTabWideAgentHintLeafId: () => LEAF_ID
    } as unknown as Parameters<typeof registerRuntimeTerminalTab>[0])
    try {
      const activeLeafOf = (): unknown => {
        const tab = buildMobileSessionTabSnapshots(mountedState, false).find(
          (snapshot) => snapshot.worktree === MOUNTED_WT
        )?.tabs[0]
        return tab?.type === 'terminal' ? tab.parentLayout?.activeLeafId : undefined
      }

      const before = activeLeafOf()
      activeIndex = 1
      const after = activeLeafOf()

      expect(before).toBe(LEAF_ID)
      expect(after).toBe('ffffffff-1111-4111-8111-111111111111')
    } finally {
      unregister()
    }
  })
})

describe('publication-wide memos the gate depends on', () => {
  it('reuses the worktree id set until one of its source slices is replaced', () => {
    const { state } = makeGateState(4)
    const first = collectMobileSessionWorktreeIds(state, state.browserTabsByWorktree ?? {})

    expect(collectMobileSessionWorktreeIds(state, state.browserTabsByWorktree ?? {})).toBe(first)

    const withNewWorktree = patchGateState(state, {
      groupsByWorktree: { ...state.groupsByWorktree, 'repo::/gate-late': [] }
    })
    const second = collectMobileSessionWorktreeIds(
      withNewWorktree,
      withNewWorktree.browserTabsByWorktree ?? {}
    )

    expect(second).not.toBe(first)
    expect(second.has('repo::/gate-late')).toBe(true)
  })

  it('keeps an untouched worktree bucket identical when a tab-keyed record is replaced', () => {
    const { state } = makeGateState(4)
    const owners = getTerminalTabOwnershipIndex(state.tabsByWorktree)
    const partition = createTabKeyedRecordPartitioner<Record<number, string>>()
    // The store replaces the record but keeps every untouched entry object, which is what the
    // bucket comparison relies on.
    const untouched = { 1: 'vim' }
    const before = partition({ 'gate-dirty-term': untouched }, owners)
    const after = partition(
      { 'gate-dirty-term': untouched, 'gate-filler-term-0': { 1: 'less' } },
      owners
    )

    expect(after.get(DIRTY_WT)).toBe(before.get(DIRTY_WT))
    expect(after.get('repo::/gate-filler-0')?.get('gate-filler-term-0')).toEqual({ 1: 'less' })
  })

  it('drops a bucket whose tab id became ambiguous', () => {
    const owners = getTerminalTabOwnershipIndex({
      [DIRTY_WT]: [makeTab('shared-term', DIRTY_WT)],
      'repo::/gate-other': [makeTab('shared-term', 'repo::/gate-other')]
    })
    const partition = createTabKeyedRecordPartitioner<Record<number, string>>()

    expect([...partition({ 'shared-term': { 1: 'vim' } }, owners).keys()]).toEqual([])
  })
})
