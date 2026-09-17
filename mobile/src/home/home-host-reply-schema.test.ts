import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { homeHostAccountsSchema, homeHostStatsSchema } from './home-host-reply-schema'

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

describe('a stats row is checked as an object and nothing more', () => {
  it('reads the row a current host sends', () => {
    const row = {
      totalAgentsSpawned: 3,
      totalPRsCreated: 1,
      totalAgentTimeMs: 90,
      firstEventAt: 1700000000000
    }
    expect(reads(homeHostStatsSchema, row)).toMatchObject(row)
  })

  it('reads a host that answers a shape totalHomeStats still sums', () => {
    expect(reads(homeHostStatsSchema, { totalWorktrees: 3 })).toMatchObject({ totalWorktrees: 3 })
    expect(reads(homeHostStatsSchema, {}).totalAgentsSpawned).toBe(undefined)
  })

  it('preserves an explicit null firstEventAt, which the total reads as no events yet', () => {
    expect(reads(homeHostStatsSchema, { firstEventAt: null }).firstEventAt).toBe(null)
    expect(reads(homeHostStatsSchema, { firstEventAt: 'never' }).firstEventAt).toBe(undefined)
  })

  it('keeps a null or absent summary out of the card slot', () => {
    expect(refuses(homeHostStatsSchema, null)).toBe(true)
    expect(refuses(homeHostStatsSchema, undefined)).toBe(true)
  })
})

describe('the accounts snapshot stays opaque', () => {
  it('takes every shape decodeAccountsSnapshot judges', () => {
    expect(refuses(homeHostAccountsSchema, null)).toBe(false)
    expect(refuses(homeHostAccountsSchema, { claude: { accounts: [] } })).toBe(false)
  })
})
