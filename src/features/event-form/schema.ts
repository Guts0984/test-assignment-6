import * as z from 'zod/mini';

/**
 * The SHAPE of the form (types and ranges), checked with Zod. `zod/mini` is 4 KB instead of the 92 KB of
 * full Zod, which matters for the 200 KB first-load budget. Meaning ("does the end come after the start,
 * in real time, in this zone?") is checked by `buildBody`, which can also see the zone and the clock.
 */
const weekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);

export const formSchema = z.object({
  title: z.string(),
  roomId: z.string(),
  startDate: z.string(),
  startTime: z.string(),
  endDate: z.string(),
  endTime: z.string(),
  allDay: z.boolean(),
  repeat: z.object({
    kind: z.enum(['none', 'daily', 'weekly', 'monthly']),
    interval: z.number(),
    weekdays: z.array(weekday),
    end: z.union([
      z.object({ kind: z.literal('never') }),
      z.object({ kind: z.literal('until'), until: z.string() }),
      z.object({ kind: z.literal('count'), count: z.number() }),
    ]),
  }),
  attendeeIds: z.array(z.string()),
  description: z.string(),
});
