import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { segmentsOf } from '../domain/segments';
import { PX_PER_HOUR } from './EventBlock';
import { TimeGrid, type GridColumn } from './TimeGrid';
import { kyivEvent, roomMap, STORY_TZ, withEnv } from '../story-support';

const event = kyivEvent('09:00', '10:00', { title: 'Design review', eventId: 'drag-me' });
const day = (d: number, withEvent: boolean): GridColumn => {
  const date = { y: 2026, m: 12, d };
  return {
    id: `day-${d}`,
    date,
    title: `Dec ${d}`,
    timed: withEvent ? segmentsOf(event, STORY_TZ, date, date) : [],
    allDay: [],
  };
};
const columns = [day(2, true), day(3, false)];

const meta = {
  title: 'Calendar/TimeGrid',
  decorators: [withEnv],
  component: TimeGrid,
  parameters: { layout: 'fullscreen' },
  args: {
    columns,
    rooms: roomMap,
    showRoom: true,
    label: 'Week',
    onMove: fn(),
    onResize: fn(),
    onCreate: fn(),
    onActivate: fn(),
    onOpen: fn(),
    onChange: fn(),
  },
  render: (args) => (
    <div style={{ height: 420 }}>
      <TimeGrid {...args} />
    </div>
  ),
} satisfies Meta<typeof TimeGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + 8 };
};

export const DragToAnotherDayAndTime: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const block = await canvas.findByRole('button', { name: /Design review/ });
    const target = canvasElement.querySelector('[data-column-id="day-3"]') as HTMLElement;
    const from = centre(block);
    const to = {
      clientX: centre(target).clientX,
      clientY: from.clientY + 2 * PX_PER_HOUR, // two hours later
    };
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: block, coords: from },
      { coords: { clientX: from.clientX + 10, clientY: from.clientY + 10 } },
      { target, coords: to },
      { keys: '[/MouseLeft]', target, coords: to },
    ]);
    await waitFor(() => expect(args.onMove).toHaveBeenCalledTimes(1));
    const [segment, column, startMin] = (args.onMove as ReturnType<typeof fn>).mock.calls[0] as [
      { event: { eventId: string } },
      GridColumn,
      number,
    ];
    await expect(segment.event.eventId).toBe('drag-me');
    await expect(column.id).toBe('day-3');
    await expect(startMin).toBe(11 * 60); // 09:00 + 2 h, snapped to the quarter hour
  },
};

export const ClickIsNotADrag: Story = {
  play: async ({ canvasElement, args }) => {
    const block = await within(canvasElement).findByRole('button', { name: /Design review/ });
    await userEvent.click(block);
    // Pressing and releasing without moving past the threshold must never move the event.
    await expect(args.onMove).not.toHaveBeenCalled();
  },
};

export const DragOnEmptySlotCreates: Story = {
  play: async ({ canvasElement, args }) => {
    const grid = canvasElement.querySelector('[data-testid="time-grid"]') as HTMLElement;
    // The grid opens scrolled to 07:00 (once, after mount); wait for that, then scroll to the afternoon.
    await waitFor(() => expect(grid.scrollTop).toBe(7 * PX_PER_HOUR));
    grid.scrollTop = 12 * PX_PER_HOUR;
    const target = canvasElement.querySelector('[data-column-id="day-3"]') as HTMLElement;
    const { top, left, width } = target.getBoundingClientRect();
    const x = left + width / 2;
    const at = (hour: number) => ({ clientX: x, clientY: top + hour * PX_PER_HOUR });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target, coords: at(14) },
      { target, coords: at(14.25) },
      { target, coords: at(15) },
      { keys: '[/MouseLeft]', target, coords: at(15) },
    ]);
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledTimes(1));
    const [column, startMin, endMin] = (args.onCreate as ReturnType<typeof fn>).mock.calls[0] as [
      GridColumn,
      number,
      number,
    ];
    await expect(column.id).toBe('day-3');
    await expect([startMin, endMin]).toEqual([14 * 60, 15 * 60]);
  },
};
