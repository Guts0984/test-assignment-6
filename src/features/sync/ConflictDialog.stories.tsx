import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { EventDto } from '@/shared/contracts';
import ConflictDialog from './ConflictDialog';
import { remove, update } from './testing';
import type { DeleteCommand, UpdateCommand } from './types';

const server: EventDto = {
  id: 'e1',
  roomId: 'room-b',
  title: 'Planning (moved by Bob)',
  description: '',
  startAt: '2026-12-02T10:00:00Z',
  endAt: '2026-12-02T11:00:00Z',
  allDay: false,
  tzid: 'Europe/Kyiv',
  rrule: null,
  exdates: [],
  seriesId: null,
  originalStart: null,
  version: 3,
  creatorId: 'u-bob',
  attendeeIds: [],
};
const roomNames: Record<string, string> = { 'room-a': 'Aurora', 'room-b': 'Borealis' };
const format = {
  time: (iso: string) => iso.replace('T', ' ').slice(0, 16),
  room: (id: string) => roomNames[id] ?? id,
  people: (ids: string[]) => ids.join(', '),
};

const meta = {
  title: 'Sync/ConflictDialog',
  component: ConflictDialog,
  args: { format, onResolve: fn() },
} satisfies Meta<typeof ConflictDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MyChangeAgainstTheirs: Story = {
  args: {
    conflict: {
      command: update('e1', 1, {
        title: 'Planning',
        startAt: '2026-12-02T14:00:00Z',
        endAt: '2026-12-02T15:00:00Z',
      }) as UpdateCommand,
      current: server,
    },
  },
  play: async ({ canvasElement, args }) => {
    // The dialog is modal (top layer), so query the whole document.
    const dialog = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(dialog.getByTestId('conflict-dialog')).toBeVisible());
    // Synthetic key presses never trigger a dialog's close request, so send the browser's own event.
    const cancel = new Event('cancel', { cancelable: true });
    dialog.getByTestId('conflict-dialog').dispatchEvent(cancel);
    await expect(cancel.defaultPrevented).toBe(true); // cannot be dismissed without choosing
    await expect(dialog.getByTestId('conflict-dialog')).toBeVisible();
    await userEvent.click(dialog.getByTestId('conflict-server'));
    await expect(args.onResolve).toHaveBeenCalledWith('server');
  },
};

export const MyDeleteAgainstTheirs: Story = {
  args: { conflict: { command: remove('e1', 1) as DeleteCommand, current: server } },
};

export const DeletedMeanwhile: Story = {
  args: { conflict: { command: remove('e1', 1) as DeleteCommand, current: null } },
};
