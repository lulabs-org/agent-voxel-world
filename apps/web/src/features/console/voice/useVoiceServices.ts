import type { VoiceServiceView } from '@voxel/shared';
import { useEffect, useState } from 'react';
import { voiceApi } from './api';
export function useVoiceServices(
  open: boolean,
  setError: (error: string) => void,
) {
  const [voiceServices, setVoiceServices] = useState<VoiceServiceView[]>([]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void voiceApi
      .listVoiceServices(abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setVoiceServices(list);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取语音服务。');
      });
    return () => abort.abort();
  }, [open, setError]);
  return { voiceServices, setVoiceServices };
}
