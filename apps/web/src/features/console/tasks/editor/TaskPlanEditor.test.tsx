// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { hasPlanTokenLimit, type TaskPlanDraft } from '@voxel/shared';
import { TaskPlanEditor } from './TaskPlanEditor';

it.each(['immediate', 'once', 'interval', 'daily', 'weekly'])(
  'shows and saves independent cumulative quota settings for %s plans',
  async (kind) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    const root = createRoot(host);
    const onSave = vi.fn<
      (
        draft: TaskPlanDraft,
        requestId: string,
        characterId: string,
      ) => Promise<void>
    >(async () => {});
    try {
      await act(async () =>
        root.render(
          <TaskPlanEditor busy={false} characters={[]} onSave={onSave} />,
        ),
      );
      const timing = host.querySelectorAll('select')[1];
      await act(async () => {
        timing.value = kind;
        timing.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const toggle = host.querySelector<HTMLInputElement>(
        '.plans-total-budget-toggle input',
      )!;
      expect(toggle).not.toBeNull();
      expect(toggle.checked).toBe(true);
      expect(
        host.querySelector('.plans-total-budget-field input'),
      ).not.toBeNull();
      const submit = async () =>
        act(async () => {
          host
            .querySelector('form')!
            .dispatchEvent(
              new Event('submit', { bubbles: true, cancelable: true }),
            );
        });
      await submit();
      const enabled = onSave.mock.calls[0]?.[0];
      expect(enabled).toMatchObject({
        timing: { kind },
        totalTokenBudgetEnabled: true,
        totalTokenBudget: 500000,
      });
      expect(hasPlanTokenLimit(enabled)).toBe(true);
      await act(async () => toggle.click());
      expect(host.querySelector('.plans-total-budget-field input')).toBeNull();
      await submit();
      const disabled = onSave.mock.calls[1]?.[0];
      expect(disabled.totalTokenBudgetEnabled).toBe(false);
      expect(hasPlanTokenLimit(disabled)).toBe(false);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);

it('explains a locked character only when clicked, including repeated clicks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { ConsoleFeedbackContext } = await import(
    '../../../../components/ui/ConsoleFeedbackRelay'
  );
  const host = document.createElement('div');
  const root = createRoot(host);
  const feedback = { setError: vi.fn(), setNotice: vi.fn() };
  try {
    await act(async () =>
      root.render(
        <ConsoleFeedbackContext.Provider value={feedback}>
          <TaskPlanEditor
            busy={false}
            characterLocked
            characters={[]}
            onSave={async () => {}}
          />
        </ConsoleFeedbackContext.Provider>,
      ),
    );
    expect(feedback.setError).not.toHaveBeenCalled();
    const button = host.querySelector<HTMLButtonElement>(
      '.plans-character-locked',
    )!;
    expect(button.type).toBe('button');
    await act(async () => button.click());
    expect(feedback.setError).toHaveBeenCalledTimes(1);
    expect(feedback.setError.mock.calls[0][0]).toBeTruthy();
    expect(host.textContent).not.toContain(feedback.setError.mock.calls[0][0]);
    await act(async () => button.click());
    expect(feedback.setError).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
