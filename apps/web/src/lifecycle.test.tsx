// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatEntry } from '@voxel/shared';
import type { PublicAICharacterView } from '@voxel/shared/management';
import { Connection } from './network/connection';
import {
  useChatController,
  type ChatController,
} from './features/chat/hooks/useChatController';
import { AudioPlayer } from './features/chat/components/AudioPlayer';
import { AICharacterDetail } from './features/console/ai-characters/AICharacterDetail';
import { initialAICharacter } from './features/console/ai-characters/model';
import { VoicePreview } from './features/console/voice/VoicePreview';
import { voiceApi } from './features/console/voice/api';
import { DeleteAICharacterDialog } from './features/console/ai-characters/DeleteAICharacterDialog';

vi.mock('./features/console/ai-characters/AICharacterForm', () => ({
  AICharacterForm: () => <input aria-label="draft" defaultValue="unsaved" />,
}));
vi.mock('./features/console/ai-characters/AICharacterLogViewer', () => ({
  AICharacterLogViewer: () => null,
}));

let root: Root;
let host: HTMLDivElement;
let mounted: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}
async function unmount() {
  await act(async () => {
    root.unmount();
  });
  mounted = false;
}
afterEach(async () => {
  if (mounted) await unmount();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps chat recording alive across rerenders and cancels on disconnect and unmount', async () => {
  const connection = new Connection();
  connection.status = 'connected';
  let controller!: ChatController;
  function Harness({ expanded }: { expanded: boolean }) {
    controller = useChatController(connection, expanded);
    return null;
  }
  await render(<Harness expanded />);
  const dictation = vi.spyOn(controller.dictation, 'cancel');
  const recorder = vi.spyOn(controller.recorder, 'cancel');
  const abort = new AbortController();
  controller.upload.current = abort;
  connection.chatRecording = true;
  await act(async () => {
    controller.setText('draft');
  });
  connection.chats = [{ seq: 5, actor: 'other' } as ChatEntry];
  await render(<Harness expanded />);
  expect(controller.text).toBe('draft');
  expect(dictation).not.toHaveBeenCalled();
  expect(connection.chatRecording).toBe(true);
  await render(<Harness expanded={false} />);
  expect(controller.unread).toBe(0);
  connection.chats = [
    ...connection.chats,
    { seq: 6, actor: 'other' } as ChatEntry,
  ];
  await render(<Harness expanded={false} />);
  expect(controller.unread).toBe(1);
  connection.status = 'disconnected';
  await render(<Harness expanded={false} />);
  expect(abort.signal.aborted).toBe(true);
  expect(connection.chatRecording).toBe(false);
  expect(dictation).toHaveBeenCalledOnce();
  expect(recorder).toHaveBeenCalledOnce();
  await unmount();
  expect(dictation).toHaveBeenCalledTimes(2);
});

it('does not reinitialize the role editor when polling updates the same role', async () => {
  const job: PublicAICharacterView = {
    ...initialAICharacter,
    id: 'a',
    name: 'A',
    providerName: 'fixture',
    status: 'idle',
    createdAt: 0,
    resourceVersion: 0,
    taskIdentity: null,
  };
  const open = vi.fn();
  const props = {
    job,
    openAgentEditor: open,
    showAgentForm: true,
    editingAgent: 'a',
    setShowAgentForm: vi.fn(),
    setError: vi.fn(),
    setNotice: vi.fn(),
  } as unknown as ComponentProps<typeof AICharacterDetail>;
  await render(
    <StrictMode>
      <AICharacterDetail {...props} />
    </StrictMode>,
  );
  expect(open).toHaveBeenCalledOnce();
  const draft = host.querySelector('input')!;
  draft.value = 'my unfinished edit';
  const newerOpen = vi.fn();
  await render(
    <StrictMode>
      <AICharacterDetail
        {...props}
        job={{ ...job, lastLog: 'polled' }}
        openAgentEditor={newerOpen}
      />
    </StrictMode>,
  );
  expect(newerOpen).not.toHaveBeenCalled();
  expect(host.querySelector('input')?.value).toBe('my unfinished edit');
  await render(
    <StrictMode>
      <AICharacterDetail
        {...props}
        job={{ ...job, id: 'b' }}
        openAgentEditor={newerOpen}
      />
    </StrictMode>,
  );
  expect(newerOpen).toHaveBeenCalledOnce();
  expect(newerOpen.mock.calls[0][0].id).toBe('b');
});

it('ignores an audio source that resolves after the player has unmounted', async () => {
  let resolve!: (url: string) => void;
  const loadSource = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  await render(<AudioPlayer loadSource={loadSource} durationMs={1000} />);
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(loadSource).toHaveBeenCalledOnce();
  await unmount();
  await act(async () => {
    resolve('blob:late');
  });
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

it('aborts the latest voice preview and stops its mounted player on cleanup', async () => {
  const create = vi.fn(() => 'blob:preview');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const preview = vi
    .spyOn(voiceApi, 'previewVoice')
    .mockResolvedValue(new Blob(['audio']));
  await render(<VoicePreview serviceId="voice-a" active />);
  await act(async () => {
    host.querySelector('button')!.click();
  });
  const signal = preview.mock.calls[0][2]!;
  const player = host.querySelector('audio')!;
  expect(player.getAttribute('src')).toBe('blob:preview');
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  const pause = vi.spyOn(player, 'pause');
  await unmount();
  expect(signal.aborted).toBe(true);
  expect(pause).toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});

it('retains the delete dialog while busy and supports cancelable Escape events', async () => {
  const cancel = vi.fn();
  const props = {
    name: 'A',
    disabled: false,
    error: '',
    onConfirm: vi.fn(),
    onCancel: cancel,
  };
  await render(<DeleteAICharacterDialog {...props} busy />);
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(cancel).not.toHaveBeenCalled();
  await render(<DeleteAICharacterDialog {...props} busy={false} />);
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(cancel).toHaveBeenCalledOnce();
});
