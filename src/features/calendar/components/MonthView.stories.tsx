import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { rangeOf } from '../domain/range';
import { MonthView } from './MonthView';
import { kyivEvent, roomMap, STORY_TZ, withEnv } from '../story-support';

const range = rangeOf('month', { y: 2026, m: 12, d: 1 }, 1, STORY_TZ);
const crowded = Array.from({ length: 7 }, (_, i) =>
  kyivEvent(`${String(8 + i).padStart(2, '0')}:00`, `${String(9 + i).padStart(2, '0')}:00`, {
    eventId: `crowd-${i}`,
    title: `Meeting ${i + 1}`,
  }),
);

const meta = {
  title: 'Calendar/MonthView',
  decorators: [withEnv],
  component: MonthView,
  args: { range, rooms: roomMap, label: 'December 2026', onOpenDay: fn(), events: crowded },
} satisfies Meta<typeof MonthView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Seven meetings on one day: three chips fit next to the "more" button, the other four collapse into it. */
export const MoreN: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const more = canvas.getByTestId('more');
    await expect(more).toHaveTextContent('4');
    await expect(within(more.parentElement as HTMLElement).getAllByText(/Meeting/)).toHaveLength(3);
    await userEvent.click(more);
    await expect(args.onOpenDay).toHaveBeenCalledTimes(1);
    await expect(args.onOpenDay).toHaveBeenCalledWith({ y: 2026, m: 12, d: 2 });
  },
};

export const Empty: Story = {
  args: { events: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('more')).toBeNull();
  },
};
