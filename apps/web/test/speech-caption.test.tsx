// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechCaption } from '../src/features/voice/SpeechCaption';
import { speechPages } from '../src/features/voice/speech-caption-text';
import type { ActiveSpeech } from '../src/audio/spatial/agent-speech-playback';
import type { SpeechAnchor } from '../src/graphics/speech-anchor';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let nextFrame: FrameRequestCallback | undefined;
const speech: ActiveSpeech = {
  id: 'a',
  actor: 'agent-id',
  name: 'AI玩家',
  scope: 'private',
  text: '你好，我可以带你探索世界。',
  durationMs: 4000,
  startedAt: 10000,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    nextFrame = undefined;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const tick = () => act(() => nextFrame?.(0));
it('switches between overhead and hidden without duplicate captions and follows the actor ID', () => {
  let point: SpeechAnchor | null = { x: 500, y: 300, width: 1000, height: 800 };
  const anchor = vi.fn(() => point);
  act(() => root.render(<SpeechCaption speech={speech} anchor={anchor} />));
  const caption = host.querySelector<HTMLElement>('.speech-caption')!;
  expect(anchor).toHaveBeenCalledWith('agent-id');
  expect(caption.dataset.placement).toBe('overhead');
  expect(caption.style.left).toBe('500px');
  expect(caption.textContent).toContain('私聊');
  point = null;
  tick();
  expect(caption.dataset.placement).toBe('hidden');
  expect(caption.style.left).toBe('');
  point = { x: 600, y: 300, width: 1000, height: 800 };
  tick();
  expect(caption.dataset.placement).toBe('overhead');
  expect(caption.style.left).toBe('600px');
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  point.y = 120;
  tick();
  expect(caption.dataset.placement).toBe('hidden');
});
it('pages long replies, holds and fades on completion, and immediately clears on cancellation', () => {
  const long = { ...speech, text: '可以探索这个世界。'.repeat(20) };
  const pages = speechPages(long.text);
  act(() => root.render(<SpeechCaption speech={long} anchor={() => null} />));
  expect(host.querySelector('p')?.textContent).toBe(pages[0]);
  vi.setSystemTime(13999);
  tick();
  expect(host.querySelector('p')?.textContent).toBe(pages.at(-1));
  act(() =>
    root.render(
      <SpeechCaption
        speech={{ ...long, endedAt: 14000 }}
        anchor={() => null}
      />,
    ),
  );
  vi.setSystemTime(16000);
  tick();
  expect(
    host.querySelector<HTMLElement>('.speech-caption')?.style.opacity,
  ).toBe('0.5');
  vi.setSystemTime(16200);
  tick();
  expect(host.querySelector('.speech-caption')).toBeNull();
  act(() =>
    root.render(<SpeechCaption speech={undefined} anchor={() => null} />),
  );
  expect(host.textContent).toBe('');
});
it('preserves all text including emoji across bounded pages', () => {
  const text = '你好🌍，让我们一起探索世界。'.repeat(20);
  const pages = speechPages(text);
  expect(pages.join('')).toBe(text);
  expect(pages.every((p) => Array.from(p).length <= 42)).toBe(true);
});
