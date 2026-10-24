/** Player chat control words; authorization still belongs to task policy. */
export type ControlCommand = 'pause' | 'cancel';

/**
 * Normalizes an addressed chat line and classifies it as a pause/cancel
 * instruction. Returns undefined for ordinary conversation.
 */
export function parseControlCommand(text: string): ControlCommand | undefined {
  const command = text
    .trim()
    .replace(/^@[^\n]+?\s+(?=(?:暂停|停止|取消|别建))/u, '')
    .replace(/[！!。.?？\s]+$/u, '');
  if (!/^(暂停|暂停任务|停止|停止任务|别建了|取消|取消任务)$/u.test(command))
    return undefined;
  return command.startsWith('取消') ? 'cancel' : 'pause';
}
