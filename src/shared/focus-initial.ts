/**
 * A modal <dialog> focuses its first focusable element when opened, which is a close button more often
 * than the field you want. Mark the right one with `data-autofocus` and call this right after showModal().
 * (React's `autoFocus` runs before the dialog is open, so it does not help here.)
 */
export function focusInitial(dialog: HTMLDialogElement | null): void {
  dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}
