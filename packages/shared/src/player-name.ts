export const PLAYER_NAME_TAKEN = 4409;
export const PLAYER_NAME_TAKEN_MESSAGE =
  '这个昵称已被使用（包括正在重连的玩家），请换一个昵称。';

export function normalizePlayerName(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  return name.slice(0, 24).trim() || 'Explorer';
}

export function playerNameKey(value: unknown): string {
  return normalizePlayerName(value).toLowerCase();
}
