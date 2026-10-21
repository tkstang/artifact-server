/**
 * Clipboard writes for Share and Settings. Browsers reject a write when the
 * page lacks permission or focus; the reader then gets one plain sentence and
 * the value already selected, never the browser's exception text.
 */

/** Write text to the clipboard; resolves false when the browser refuses. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The message shown when a value could not be copied, naming what it was. */
export function manualCopyMessage(noun: string): string {
  return `Couldn't copy — select the ${noun} and copy it.`;
}

/** Select an element's text so the reader can copy it with the keyboard. */
export function selectForManualCopy(element: Element | null): void {
  if (element === null) return;
  const selection = window.getSelection();
  if (selection === null) return;
  selection.selectAllChildren(element);
}
