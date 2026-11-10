import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { SyncIndicator } from './SyncIndicator';
import type { SyncState } from './types';

const state = (over: Partial<SyncState>): SyncState => ({
  status: 'saved',
  pending: 0,
  conflict: null,
  storageFailed: false,
  ...over,
});

const meta = { title: 'Sync/SyncIndicator', component: SyncIndicator } satisfies Meta<
  typeof SyncIndicator
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = { args: { state: state({}) } };
export const Syncing: Story = { args: { state: state({ status: 'syncing', pending: 2 }) } };
export const Offline: Story = { args: { state: state({ status: 'offline' }) } };
export const OfflineWithQueue: Story = {
  args: { state: state({ status: 'offline', pending: 5 }) },
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status');
    await expect(status).toHaveAttribute('data-pending', '5');
    await expect(status).toHaveTextContent('5');
  },
};
export const NeedsAttention: Story = {
  args: { state: state({ status: 'signed-out', pending: 3 }) },
};
export const StorageFailed: Story = {
  args: { state: state({ pending: 1, storageFailed: true }) },
  play: async ({ canvasElement }) => {
    // Changes that cannot be written to IndexedDB would vanish on reload: the indicator must warn.
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('!');
  },
};
