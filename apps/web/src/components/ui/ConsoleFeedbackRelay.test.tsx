// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ConsoleFeedbackContext,
  ConsoleFeedbackRelay,
} from './ConsoleFeedbackRelay';
let host: HTMLDivElement;
let root: Root;
const feedback = { setError: vi.fn(), setNotice: vi.fn() };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(error = '', active = true, notice = '') {
  await act(async () =>
    root.render(
      <ConsoleFeedbackContext.Provider value={feedback}>
        <ConsoleFeedbackRelay error={error} notice={notice} active={active} />
      </ConsoleFeedbackContext.Provider>,
    ),
  );
}
it('forwards a failed action to the shared toast without inline layout changes', async () => {
  await render('请先处理或结束异常执行。');
  expect(feedback.setError).toHaveBeenCalledWith('请先处理或结束异常执行。');
  expect(feedback.setNotice).toHaveBeenCalledWith('');
  expect(host.textContent).toBe('');
  await render('请先处理或结束异常执行。');
  expect(feedback.setError).toHaveBeenCalledTimes(1);
  await render();
  await render('请先处理或结束异常执行。');
  expect(feedback.setError).toHaveBeenCalledTimes(2);
});
it('does not replay stale feedback when switching back to a hidden tab', async () => {
  await render('hidden error', false);
  await render('hidden error', true);
  expect(feedback.setError).not.toHaveBeenCalled();
  await render('new error', true);
  expect(feedback.setError).toHaveBeenCalledWith('new error');
});
it('forwards successful operations and clears conflicting errors', async () => {
  await render('', true, 'Saved');
  expect(feedback.setNotice).toHaveBeenCalledWith('Saved');
  expect(feedback.setError).toHaveBeenCalledWith('');
});
