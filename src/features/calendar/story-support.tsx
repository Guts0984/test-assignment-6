import type { Decorator } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import type { RoomDto } from '@/shared/contracts';
import { makeEvent } from '@/shared/calendar/test-utils';
import type { CalEvent } from '@/shared/calendar/types';
import { weekStartOf } from './domain/range';
import { segmentsOf, type Segment } from './domain/segments';
import { EnvProvider, type CalendarEnv } from './context';
import type { Names } from './format';
import { PX_PER_HOUR } from './components/EventBlock';
import en from '../../../messages/en.json';
import uk from '../../../messages/uk.json';

/** What the stories need to look like the real app: the viewer's zone, clock and the catalog's names. */
export const STORY_TZ = 'Europe/Kyiv';

const namesOf = (catalog: typeof en): Names => ({
  weekdayShort: catalog.weekdays.short,
  weekdayLong: catalog.weekdays.long,
  monthLong: catalog.months.long,
  monthShort: catalog.months.short,
  monthGenitive: catalog.months.genitive,
  time: catalog.time,
});

export const envFor = (locale: 'uk' | 'en', over: Partial<CalendarEnv> = {}): CalendarEnv => ({
  tz: STORY_TZ,
  tz2: null,
  locale,
  clock: locale === 'en' ? '12h' : '24h',
  weekStart: weekStartOf(locale),
  names: namesOf(locale === 'en' ? en : (uk as unknown as typeof en)),
  userId: 'u-ana',
  ...over,
});

export const withEnv: Decorator = (Story, context) => (
  <EnvProvider value={envFor(context.globals.locale === 'uk' ? 'uk' : 'en')}>
    <Story />
  </EnvProvider>
);

export const rooms: readonly RoomDto[] = [
  { id: 'room-a', name: 'Aurora', floor: 1, capacity: 4 },
  { id: 'room-b', name: 'Borealis', floor: 2, capacity: 8 },
];
export const roomMap = new Map(rooms.map((r) => [r.id, r]));

/** An event on 2026-12-02 (Kyiv is UTC+2 then): `from`/`to` are Kyiv wall-clock times "HH:MM". */
export function kyivEvent(from: string, to: string, over: Partial<CalEvent> = {}): CalEvent {
  const at = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return `2026-12-02T${String(h - 2).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  };
  return makeEvent(at(from), at(to), over);
}

export const segmentOf = (event: CalEvent): Segment => {
  const segment = segmentsOf(event, STORY_TZ)[0];
  if (!segment) throw new Error('story event has no segment');
  return segment;
};

/** A slice of one day column (the hours `fromHour`..`toHour`) to place event blocks in. */
export function ColumnSlice({
  fromHour = 8,
  toHour = 13,
  width = 260,
  children,
}: {
  fromHour?: number;
  toHour?: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="grid-hours border-border relative overflow-hidden border-l"
      style={{
        width,
        height: (toHour - fromHour) * PX_PER_HOUR,
        ['--hour' as string]: `${PX_PER_HOUR}px`,
      }}
    >
      <div
        className="absolute inset-x-0"
        style={{ top: -fromHour * PX_PER_HOUR, height: 24 * PX_PER_HOUR }}
      >
        {children}
      </div>
    </div>
  );
}
