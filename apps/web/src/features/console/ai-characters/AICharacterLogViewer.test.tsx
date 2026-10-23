// @vitest-environment jsdom
import type { AICharacterSummary } from '@voxel/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AICharacterLogViewer } from './AICharacterLogViewer';
import { aiCharactersApi } from './api';

let host: HTMLDivElement;
let root: Root;
const job = { id: 'character-a' } as AICharacterSummary;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderLogs() {
  await act(async () => root.render(<AICharacterLogViewer job={job} />));
  const list = host.querySelector<HTMLOListElement>('.agents-log-list')!;
  Object.defineProperties(list, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 360, configurable: true },
  });
  return list;
}

async function scrollTo(list: HTMLOListElement, top: number) {
  await act(async () => {
    list.scrollTop = top;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

it('loads the next log page once when the list nears its bottom', async () => {
  const getLogs = vi.spyOn(aiCharactersApi, 'getLogs');
  getLogs
    .mockResolvedValueOnce({
      entries: [{ time: 1, text: 'newer' }],
      nextCursor: 'older-page',
      total: 2,
    })
    .mockResolvedValueOnce({
      entries: [{ time: 0, text: 'older' }],
      total: 2,
    });
  const list = await renderLogs();

  await scrollTo(list, 200);
  expect(getLogs).toHaveBeenCalledTimes(1);

  await act(async () => {
    list.scrollTop = 600;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(getLogs).toHaveBeenCalledTimes(2);
  expect(getLogs).toHaveBeenLastCalledWith('character-a', 'older-page');
  expect(list.textContent).toContain('newer');
  expect(list.textContent).toContain('older');
});

it('stops automatic retries after a page failure and offers a retry button', async () => {
  const getLogs = vi.spyOn(aiCharactersApi, 'getLogs');
  getLogs
    .mockResolvedValueOnce({
      entries: [{ time: 1, text: 'newer' }],
      nextCursor: 'older-page',
      total: 2,
    })
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({
      entries: [{ time: 0, text: 'older' }],
      total: 2,
    });
  const list = await renderLogs();

  await scrollTo(list, 600);
  await scrollTo(list, 600);
  expect(getLogs).toHaveBeenCalledTimes(2);
  const retry = host.querySelector<HTMLButtonElement>(
    '.agents-log-load-status button',
  );
  expect(retry).not.toBeNull();

  await act(async () => retry?.click());
  expect(getLogs).toHaveBeenCalledTimes(3);
  expect(list.textContent).toContain('older');
});
