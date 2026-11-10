import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { api } from '@/shared/api/client';
import type { OccurrenceDto } from '@/shared/contracts';
import { mockRooms, mockUsers } from '@/shared/mocks/fixtures';
import { formatInstant, parseInstant } from '@/shared/zoned';
import { envFor, STORY_TZ } from '../calendar/story-support';
import EventPanel from './EventPanel';

const env = envFor('en');

/** Asks the (mocked) API which rooms have something in the window: the same call the real app makes. */
async function fetchBusy(from: number, to: number, signal: AbortSignal): Promise<Set<string>> {
  const result = await api.get<{ occurrences: OccurrenceDto[] }>(
    `/api/events?from=${encodeURIComponent(formatInstant(from))}&to=${encodeURIComponent(formatInstant(to))}`,
    signal,
  );
  if (!result.ok) throw new Error('busy lookup failed');
  return new Set(result.data.occurrences.map((o) => o.roomId));
}

const meta = {
  title: 'EventForm/EventPanel',
  component: EventPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    // 12:00–13:00 Kyiv on 2026-12-01 = 10:00–11:00 UTC: Aurora and Borealis are booked then (see the mocks).
    mode: {
      kind: 'create',
      date: { y: 2026, m: 12, d: 1 },
      startMin: 720,
      endMin: 780,
      roomId: null,
    },
    tz: STORY_TZ,
    clock: '24h',
    labels: env.names.time,
    weekStart: 1,
    rooms: mockRooms,
    users: mockUsers,
    onCreate: fn(),
    onEdit: fn(),
    onDelete: fn(),
    onClose: fn(),
    fetchBusy,
  },
} satisfies Meta<typeof EventPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

const body = (el: HTMLElement) => within(el.ownerDocument.body);

export const Empty: Story = {};

export const SuggestsFreeRoomsAndCreates: Story = {
  play: async ({ canvasElement, args }) => {
    const ui = body(canvasElement);
    const suggestions = await ui.findAllByTestId('free-room');
    // Only the room nobody booked is offered for that hour.
    await expect(suggestions.map((s) => s.textContent)).toEqual(['Cosmos']);

    await userEvent.selectOptions(ui.getByTestId('field-room'), 'room-a');
    await expect(await ui.findByTestId('room-busy')).toBeVisible();

    await userEvent.click(suggestions[0] as HTMLElement);
    await expect(ui.getByTestId('field-room')).toHaveValue('room-c');
    await waitFor(() => expect(ui.queryByTestId('room-busy')).toBeNull());

    await userEvent.type(ui.getByTestId('field-title'), 'Retro');
    await userEvent.click(ui.getByTestId('panel-save'));
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledTimes(1));
    await expect(args.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-c',
        title: 'Retro',
        start: parseInstant('2026-12-01T10:00:00Z'),
        end: parseInstant('2026-12-01T11:00:00Z'),
        tzid: STORY_TZ,
      }),
    );
  },
};

export const RefusesWithoutTitle: Story = {
  play: async ({ canvasElement, args }) => {
    const ui = body(canvasElement);
    await userEvent.click(await ui.findByTestId('panel-save'));
    await expect(
      await ui.findByText(/title/i, { selector: '[id^="err-"], p, span' }),
    ).toBeVisible();
    await expect(args.onCreate).not.toHaveBeenCalled();
  },
};

export const RejectsEndBeforeStart: Story = {
  play: async ({ canvasElement, args }) => {
    const ui = body(canvasElement);
    await userEvent.type(await ui.findByTestId('field-title'), 'Backwards');
    await userEvent.selectOptions(ui.getByTestId('field-room'), 'room-c');
    const end = ui.getByTestId('field-end-time');
    await userEvent.clear(end);
    await userEvent.type(end, '11:00');
    await userEvent.click(ui.getByTestId('panel-save'));
    await expect(args.onCreate).not.toHaveBeenCalled();
    await expect(ui.getByTestId('event-panel')).toBeVisible();
  },
};
