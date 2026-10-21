// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConsoleFeedback } from '../src/features/console/useConsoleFeedback';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('auto-dismisses notice after 3500ms', () => {
  let feedbackRef: ReturnType<typeof useConsoleFeedback> = undefined!;
  function TestComp() {
    feedbackRef = useConsoleFeedback();
    return (
      <div>
        <span data-testid="notice">{feedbackRef.notice}</span>
        <button
          onClick={() => feedbackRef.setNotice('AI 角色设置已保存。')}
          data-testid="set-notice"
        >
          Set
        </button>
      </div>
    );
  }

  act(() => {
    root.render(<TestComp />);
  });

  expect(feedbackRef.notice).toBe('');

  act(() => {
    feedbackRef.setNotice('AI 角色设置已保存。');
  });
  expect(feedbackRef.notice).toBe('AI 角色设置已保存。');

  // Advance less than timeout
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(feedbackRef.notice).toBe('AI 角色设置已保存。');

  // Advance past 3500ms
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(feedbackRef.notice).toBe('');
});

it('auto-dismisses error after 6000ms', () => {
  let feedbackRef: ReturnType<typeof useConsoleFeedback> = undefined!;
  function TestComp() {
    feedbackRef = useConsoleFeedback();
    return <div>{feedbackRef.error}</div>;
  }

  act(() => {
    root.render(<TestComp />);
  });

  act(() => {
    feedbackRef.setError('无法保存设置');
  });
  expect(feedbackRef.error).toBe('无法保存设置');

  act(() => {
    vi.advanceTimersByTime(4000);
  });
  expect(feedbackRef.error).toBe('无法保存设置');

  act(() => {
    vi.advanceTimersByTime(2500);
  });
  expect(feedbackRef.error).toBe('');
});
