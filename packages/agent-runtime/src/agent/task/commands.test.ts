import { describe, expect, it } from 'vitest';
import { parseControlCommand } from './commands';

describe('parseControlCommand', () => {
  it('classifies pause and cancel words with optional punctuation', () => {
    expect(parseControlCommand('暂停')).toBe('pause');
    expect(parseControlCommand('停止任务！')).toBe('pause');
    expect(parseControlCommand('别建了。')).toBe('pause');
    expect(parseControlCommand('取消任务?')).toBe('cancel');
    expect(parseControlCommand('  取消  ')).toBe('cancel');
  });

  it('strips a leading mention before classifying', () => {
    expect(parseControlCommand('@小明 暂停')).toBe('pause');
    expect(parseControlCommand('@小明 取消。')).toBe('cancel');
  });

  it('leaves ordinary conversation to the chat path', () => {
    expect(parseControlCommand('暂停一下好吗，帮我看看进度')).toBeUndefined();
    expect(parseControlCommand('继续建造')).toBeUndefined();
    expect(parseControlCommand('')).toBeUndefined();
  });
});
