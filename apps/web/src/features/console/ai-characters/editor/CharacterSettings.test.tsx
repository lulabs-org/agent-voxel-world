// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AI_CHARACTER_PERMISSIONS,
  type AICharacterSettings,
  type VoiceServiceView,
} from '@voxel/shared';
import { initialAICharacter } from '../model';
import { CharacterCapabilities } from './CharacterCapabilities';
import { CharacterVoiceSettings } from './CharacterVoiceSettings';
import { CharacterBudgetSettings } from './CharacterBudgetSettings';

let host: HTMLDivElement, root: Root, draft: AICharacterSettings;
function Harness({
  services = [],
  disabled = false,
}: {
  services?: VoiceServiceView[];
  disabled?: boolean;
}) {
  const [agent, setAgent] = useState<AICharacterSettings>({
    ...initialAICharacter,
    tokenBudget: 123456,
  });
  draft = agent;
  return (
    <fieldset disabled={disabled}>
      <CharacterCapabilities agent={agent} setAgent={setAgent} />
      <CharacterVoiceSettings
        agent={agent}
        setAgent={setAgent}
        voiceServices={services}
      />
      <CharacterBudgetSettings agent={agent} setAgent={setAgent} />
    </fieldset>
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function permission(id: string) {
  const name = AI_CHARACTER_PERMISSIONS.find((p) => p.id === id)!.name;
  return [
    ...host.querySelectorAll<HTMLLabelElement>('label.agents-capability-card'),
  ]
    .find((el) => el.querySelector('strong')?.textContent === name)!
    .querySelector<HTMLInputElement>('input')!;
}
it('keeps edit permissions synchronized with allowEdits', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => permission('place').click());
  expect(draft.permissions?.place).toBe(true);
  expect(draft.allowEdits).toBe(false);
  await act(async () => permission('remove').click());
  expect(draft.allowEdits).toBe(true);
  await act(async () => permission('place').click());
  expect(draft.allowEdits).toBe(false);
  expect(draft.permissions?.remove).toBe(true);
});
it('requires chat permission and a service for voice, retaining the selected service when switched off', async () => {
  const services = [{ id: 'voice-a', name: 'Voice A' }] as VoiceServiceView[];
  await act(async () => root.render(<Harness />));
  expect(
    host.querySelector<HTMLButtonElement>('#voice-reply-switch')!.disabled,
  ).toBe(true);
  await act(async () => root.render(<Harness services={services} />));
  const toggle = host.querySelector<HTMLButtonElement>('#voice-reply-switch')!;
  await act(async () => toggle.click());
  expect(draft.voiceReplies).toBe(true);
  expect(draft.voiceServiceId).toBe('voice-a');
  await act(async () => toggle.click());
  expect(draft.voiceReplies).toBe(false);
  expect(draft.voiceServiceId).toBe('voice-a');
  await act(async () => permission('chat').click());
  expect(toggle.disabled).toBe(true);
});
it('retains configured budgets when toggled off and respects the parent disabled fieldset', async () => {
  await act(async () => root.render(<Harness />));
  const toggle = host.querySelector<HTMLButtonElement>('#task-limits-switch')!;
  await act(async () => toggle.click());
  expect(draft.taskLimitsEnabled).toBe(true);
  expect(host.querySelector('.agents-budget-content')).not.toBeNull();
  await act(async () => toggle.click());
  expect(draft.taskLimitsEnabled).toBe(false);
  expect(draft.tokenBudget).toBe(123456);
  await act(async () => root.render(<Harness disabled />));
  await act(async () => toggle.click());
  expect(draft.taskLimitsEnabled).toBe(false);
});
