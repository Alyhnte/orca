import { z } from 'zod'
import { salvagedOptional } from '../../../src/shared/zod-salvage'

// The Home card's two per-host reads. Checked against `stats.summary`
// (src/main/runtime/rpc/methods/stats.ts, `runtime.getStatsSummary() ?? {}`) and `accounts.list`
// (src/main/runtime/rpc/methods/accounts.ts, `runtime.getAccountsSnapshot()`).

/**
 * One host's lifetime-usage row.
 *
 * Every member is optional and none is required, because `totalHomeStats` is the reader and it says
 * so itself: it skips a non-object row and runs every number through `finiteOrZero`
 * (home-stats-total.ts:33-39). What the schema adds is that the stored row is an object at all —
 * the card keeps one slot per host for the life of the process, so a null or absent summary used to
 * sit in that slot until the host replied again.
 *
 * `firstEventAt` keeps its explicit `null`: that is the host's "no events yet", and the total
 * distinguishes it from a number when taking the minimum.
 */
export const homeHostStatsSchema = z.looseObject({
  totalAgentsSpawned: salvagedOptional('totalAgentsSpawned', z.number()),
  totalPRsCreated: salvagedOptional('totalPRsCreated', z.number()),
  totalAgentTimeMs: salvagedOptional('totalAgentTimeMs', z.number()),
  firstEventAt: salvagedOptional('firstEventAt', z.number().nullable())
})

/**
 * One host's accounts snapshot, forwarded whole.
 *
 * `decodeAccountsSnapshot` is the validator, at the call site, and it is shared with the account
 * pane and the Codex reset sheet; declaring the provider blocks here would give the same reply two
 * decoders that could disagree about a row. The forward is opaque on purpose, not a member left
 * unchecked.
 */
export const homeHostAccountsSchema = z.unknown()
