import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { makeEvent } from '@/shared/calendar/test-utils';
import type { CalEvent } from '@/shared/calendar/types';
import { layoutColumn } from '../domain/layout';
import { EventBlock } from './EventBlock';
import { ColumnSlice, kyivEvent, roomMap, segmentOf, withEnv } from '../story-support';

/** Every state of an event block: short, long, overlapping, all-day, recurring, syncing, failed. */
const meta = { title: 'Calendar/EventBlock', decorators: [withEnv] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Column({ events }: { events: CalEvent[] }) {
  const segments = events.map(segmentOf);
  const placed = new Map(
    layoutColumn(
      segments.map((s) => ({ id: s.event.key, startMin: s.startMin, endMin: s.endMin })),
    ).map((p) => [p.id, p]),
  );
  return (
    <ColumnSlice>
      {segments.map((s) => (
        <EventBlock
          key={s.event.key}
          segment={s}
          placement={placed.get(s.event.key)}
          roomName={roomMap.get(s.event.roomId)?.name ?? ''}
          showRoom
        />
      ))}
    </ColumnSlice>
  );
}

export const Short: Story = {
  render: () => <Column events={[kyivEvent('09:00', '09:15', { title: 'Standup' })]} />,
  play: async ({ canvasElement }) => {
    const block = within(canvasElement).getByRole('button', { name: /Standup/ });
    // A short event stays readable and clickable: it is never drawn thinner than the minimum.
    await expect(block.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  },
};

export const Long: Story = {
  render: () => (
    <Column events={[kyivEvent('09:00', '12:30', { title: 'Workshop: quarterly planning' })]} />
  ),
};

export const Overlapping: Story = {
  render: () => (
    <Column
      events={[
        kyivEvent('09:00', '11:00', { title: 'Design review', eventId: 'o1' }),
        kyivEvent('09:30', '10:30', { title: 'Planning', eventId: 'o2', roomId: 'room-b' }),
        kyivEvent('10:00', '12:00', { title: 'Interview', eventId: 'o3' }),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const boxes = within(canvasElement)
      .getAllByRole('button')
      .map((b) => b.getBoundingClientRect());
    expect(boxes).toHaveLength(3);
    // No two blocks may cover each other (the layout puts overlapping events side by side).
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) {
        const overlapX = a.left < b.right - 1 && b.left < a.right - 1;
        const overlapY = a.top < b.bottom - 1 && b.top < a.bottom - 1;
        await expect(overlapX && overlapY).toBe(false);
      }
  },
};

export const AllDay: Story = {
  render: () => (
    <div style={{ width: 260 }}>
      <EventBlock
        segment={segmentOf(
          makeEvent('2026-12-01T22:00:00Z', '2026-12-02T22:00:00Z', {
            title: 'Office closed',
            allDay: true,
            eventId: 'ad',
          }),
        )}
        roomName="Aurora"
        showRoom
      />
    </div>
  ),
};

export const Recurring: Story = {
  render: () => (
    <Column events={[kyivEvent('09:00', '10:00', { title: 'Weekly sync', recurring: true })]} />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Weekly sync/ })).toBeVisible();
    await expect(canvasElement.textContent).toContain('↻');
  },
};

export const Syncing: Story = {
  render: () => (
    <Column events={[kyivEvent('09:00', '10:00', { title: 'Saving…', sync: 'syncing' })]} />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-sync="syncing"]')).not.toBeNull();
  },
};

export const SyncError: Story = {
  render: () => (
    <Column events={[kyivEvent('09:00', '10:00', { title: 'Not saved', sync: 'error' })]} />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-sync="error"]')).not.toBeNull();
  },
};
