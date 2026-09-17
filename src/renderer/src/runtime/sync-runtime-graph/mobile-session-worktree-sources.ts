import type { AppState } from '@/store/types'
import { EMPTY_LAYOUT_BY_WORKTREE } from './graph-state'
import { tabKeyedRecordBucket } from './tab-keyed-record-partition'
import type {
  MobileSessionPublicationInputs,
  MobileSessionWorktreeSourceRefs,
  TerminalTabOwnershipIndex
} from './types'

/**
 * Every store and publication value one worktree's snapshot is derived from, at the granularity
 * that actually moves.
 *
 * Why this exists: these cover every `AppState` and `MobileSessionPublicationInputs` read in
 * `buildMobileSessionWorktreeInputs`, so an unchanged set proves no *store* input moved this
 * worktree's snapshot — without building the inputs. That is the difference between per-publication
 * work proportional to every accumulated worktree and work proportional to what the frame changed.
 *
 * What is deliberately not fingerprinted: the builder also reads live PaneManager/DOM state through
 * `captureMountedTerminalSurfaces`, which no store reference can witness. Refs-equality is therefore
 * not sufficient alone, and `buildMobileSessionTabSnapshots` pairs it with a
 * `graphState.registeredTabIdsByWorktree` check and an empty cached capture map. Delete either guard
 * and a worktree cached before its pane mounted publishes its pre-mount snapshot permanently — that
 * is exactly what `sync-runtime-graph-late-terminal-mount.test.ts` pins.
 *
 * Granularity is load-bearing. Worktree-keyed slices contribute their own worktree's value, because
 * one tab title replaces the containing record but not its sibling entries. Tab-keyed records
 * contribute a partition bucket for the same reason. Everything else contributes the whole
 * reference, which is conservative: it can only force extra rebuilds, never skip a real change.
 *
 * `sync-runtime-graph-worktree-source-census.test.ts` proves the store/publication coverage by
 * recording every key the inputs builder reads and failing when this collector does not read it too.
 */
export function collectMobileSessionWorktreeSourceRefs(
  state: AppState,
  worktreeId: string,
  publication: MobileSessionPublicationInputs,
  owners: TerminalTabOwnershipIndex
): MobileSessionWorktreeSourceRefs {
  return {
    terminalTabs: state.tabsByWorktree[worktreeId],
    unifiedTabs: state.unifiedTabsByWorktree[worktreeId],
    groups: state.groupsByWorktree[worktreeId],
    tabBarOrder: state.tabBarOrderByWorktree[worktreeId],
    activeGroupId: state.activeGroupIdByWorktree[worktreeId],
    tabGroupLayout: (state.layoutByWorktree ?? EMPTY_LAYOUT_BY_WORKTREE)[worktreeId],
    activeFileIdForWorktree: state.activeFileIdByWorktree?.[worktreeId],
    activeTabTypeForWorktree: state.activeTabTypeByWorktree?.[worktreeId],
    activeBrowserWorkspaceId: state.activeBrowserTabIdByWorktree?.[worktreeId],
    activeFileId: state.activeFileId,
    activeTabId: state.activeTabId,
    activeTabType: state.activeTabType,
    browserPagesByWorkspace: state.browserPagesByWorkspace,
    browserCertificateFailuresByPageId: state.browserCertificateFailuresByPageId,
    worktreesByRepo: state.worktreesByRepo,
    terminalLayoutBucket: tabKeyedRecordBucket(publication.terminalLayoutByWorktree, worktreeId),
    paneTitleBucket: tabKeyedRecordBucket(publication.runtimePaneTitleByWorktree, worktreeId),
    launchDraftBucket: tabKeyedRecordBucket(publication.launchDraftByWorktree, worktreeId),
    browserWorkspaces: publication.browserTabsByWorktree[worktreeId],
    openFilesById: publication.openFileIndexes.byWorktreeAndId.get(worktreeId),
    openFileIds: publication.openFileIndexes.idsByWorktree.get(worktreeId),
    editorDraftVersionByFileId: publication.editorDraftVersionByFileId,
    agentStatusBucket: publication.agentStatusByWorktreeId.get(worktreeId),
    generatedTitlesEnabled: publication.generatedTitlesEnabled,
    terminalTheme: publication.terminalTheme,
    ambiguousTabIds: owners.ambiguousTabIds
  }
}

export function mobileSessionWorktreeSourceRefsEqual(
  previous: MobileSessionWorktreeSourceRefs,
  next: MobileSessionWorktreeSourceRefs
): boolean {
  return (
    previous.terminalTabs === next.terminalTabs &&
    previous.unifiedTabs === next.unifiedTabs &&
    previous.groups === next.groups &&
    previous.tabBarOrder === next.tabBarOrder &&
    previous.activeGroupId === next.activeGroupId &&
    previous.tabGroupLayout === next.tabGroupLayout &&
    previous.activeFileIdForWorktree === next.activeFileIdForWorktree &&
    previous.activeTabTypeForWorktree === next.activeTabTypeForWorktree &&
    previous.activeBrowserWorkspaceId === next.activeBrowserWorkspaceId &&
    previous.activeFileId === next.activeFileId &&
    previous.activeTabId === next.activeTabId &&
    previous.activeTabType === next.activeTabType &&
    previous.browserPagesByWorkspace === next.browserPagesByWorkspace &&
    previous.browserCertificateFailuresByPageId === next.browserCertificateFailuresByPageId &&
    previous.worktreesByRepo === next.worktreesByRepo &&
    previous.terminalLayoutBucket === next.terminalLayoutBucket &&
    previous.paneTitleBucket === next.paneTitleBucket &&
    previous.launchDraftBucket === next.launchDraftBucket &&
    previous.browserWorkspaces === next.browserWorkspaces &&
    previous.openFilesById === next.openFilesById &&
    previous.openFileIds === next.openFileIds &&
    previous.editorDraftVersionByFileId === next.editorDraftVersionByFileId &&
    previous.agentStatusBucket === next.agentStatusBucket &&
    previous.generatedTitlesEnabled === next.generatedTitlesEnabled &&
    previous.terminalTheme === next.terminalTheme &&
    previous.ambiguousTabIds === next.ambiguousTabIds
  )
}

type WorktreeIdSetCache = {
  tabsByWorktree: AppState['tabsByWorktree']
  groupsByWorktree: AppState['groupsByWorktree']
  unifiedTabsByWorktree: AppState['unifiedTabsByWorktree']
  browserTabsByWorktree: AppState['browserTabsByWorktree']
  openFiles: AppState['openFiles']
  worktreeIds: ReadonlySet<string>
}

let worktreeIdSetCache: WorktreeIdSetCache | null = null

/**
 * Every worktree that gets a mobile snapshot this publication.
 *
 * Memoized on its five source slices: an OSC frame changes none of them, yet rebuilding the set
 * re-enumerated the keys of four accumulated records on every publication.
 */
export function collectMobileSessionWorktreeIds(
  state: AppState,
  browserTabsByWorktree: AppState['browserTabsByWorktree']
): ReadonlySet<string> {
  const cached = worktreeIdSetCache
  if (
    cached &&
    cached.tabsByWorktree === state.tabsByWorktree &&
    cached.groupsByWorktree === state.groupsByWorktree &&
    cached.unifiedTabsByWorktree === state.unifiedTabsByWorktree &&
    cached.browserTabsByWorktree === browserTabsByWorktree &&
    cached.openFiles === state.openFiles
  ) {
    return cached.worktreeIds
  }
  const worktreeIds = new Set<string>([
    ...Object.keys(state.tabsByWorktree),
    ...Object.keys(state.groupsByWorktree),
    ...Object.keys(state.unifiedTabsByWorktree),
    ...Object.keys(browserTabsByWorktree),
    ...state.openFiles.map((file) => file.worktreeId)
  ])
  worktreeIdSetCache = {
    tabsByWorktree: state.tabsByWorktree,
    groupsByWorktree: state.groupsByWorktree,
    unifiedTabsByWorktree: state.unifiedTabsByWorktree,
    browserTabsByWorktree,
    openFiles: state.openFiles,
    worktreeIds
  }
  return worktreeIds
}

export function resetMobileSessionWorktreeIdCacheForTests(): void {
  worktreeIdSetCache = null
}
