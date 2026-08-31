/**
 * What the pad does on its own time, in its own module because both the query
 * layer and the heat estimator have to know it.
 *
 * They had it through each other: `heat-eta.ts` reached into `queries.ts` for
 * `PAD_SETTLE_MS` while `queries.ts` reached back for `clearHeatRuns`, and the
 * only reason that resolved at all was that both references sit inside function
 * bodies. `keys.ts` exists to avoid exactly this shape and says so, but it is
 * not the home for this: it holds query keys, and a hardware timing constant
 * filed under them would make it the place anything goes to escape a cycle.
 *
 * What belongs here is the panel's own physics — how long the hardware takes to
 * do a thing, as distinct from how often this app asks it anything. Cadences,
 * hold windows and staleness bars are decisions about polling and stay with the
 * queries that make them.
 */

/**
 * How long the pad needs before it answers sanely after a light's relay
 * drops. The refetch that releases a hold reads the whole pad, and one taken
 * right after the command lands mid-transient — turning a light off painted
 * every temperature as 0 until the next poll, with the light itself reading
 * a perfectly agreeable "off".
 */
export const PAD_SETTLE_MS = 5_000;
