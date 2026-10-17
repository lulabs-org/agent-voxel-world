import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BAILIAN_ASR,
  DEFAULT_WHISPER_ASR,
  type AsrServiceDraft,
  type AsrServiceView,
} from '@voxel/shared';
import { voiceApi } from './api';

const fresh = (provider: 'bailian' | 'whisper' = 'bailian'): AsrServiceDraft =>
  provider === 'whisper'
    ? { ...DEFAULT_WHISPER_ASR, provider, name: 'Whisper 识别' }
    : { ...DEFAULT_BAILIAN_ASR, provider, name: '阿里云识别', apiKey: '' };
const clearSecret = (draft: AsrServiceDraft): AsrServiceDraft =>
  draft.provider === 'whisper' ? draft : { ...draft, apiKey: '' };
const formFor = (id: string, saved?: AsrServiceView) => ({
  id,
  draft: saved
    ? saved.provider === 'whisper'
      ? { ...saved }
      : { ...saved, apiKey: '' }
    : fresh(),
  dirty: id === 'new',
});

export function useAsrServices(active: boolean) {
  const [services, setServices] = useState<AsrServiceView[]>([]);
  const [form, setForm] = useState(() => formFor('local'));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    setLoaded(false);
    setSaving(false);
    setForm((previous) => ({
      ...previous,
      draft: clearSecret(previous.draft),
    }));
    if (!active) return;
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    setError('');
    setNotice('');
    void voiceApi
      .listAsrServices(
        AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
      )
      .then((values) => {
        if (abort.signal.aborted) return;
        setServices(values);
        setLoaded(true);
        setForm((previous) => {
          const saved = values.find((v) => v.id === previous.id);
          return formFor(
            saved ? saved.id : previous.id === 'new' ? 'new' : 'local',
            saved,
          );
        });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : '读取识别服务失败。');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => request.current?.abort();
  }, [active, retry]);
  const choose = (id: string) => {
    setForm(
      formFor(
        id,
        services.find((v) => v.id === id),
      ),
    );
    setError('');
    setNotice('');
  };
  const change = (patch: Partial<AsrServiceDraft>) => {
    setForm((previous) => ({
      ...previous,
      draft: { ...previous.draft, ...patch } as AsrServiceDraft,
      dirty: true,
    }));
    setError('');
    setNotice('');
  };
  const mutate = async (remove: boolean, addAnother = false) => {
    if (
      !active ||
      loading ||
      saving ||
      form.id === 'local' ||
      (remove && form.id === 'new')
    )
      return;
    const abort = new AbortController();
    request.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (remove) {
        await voiceApi.deleteAsrService(form.id, signal);
        if (abort.signal.aborted) return;
        setServices((values) => values.filter((v) => v.id !== form.id));
        setForm(formFor('local'));
        setNotice('识别服务已删除。');
      } else {
        const saved = await voiceApi.saveAsrService(
          form.draft,
          signal,
          form.id === 'new' ? undefined : form.id,
        );
        if (abort.signal.aborted) return;
        setServices((values) =>
          values.some((v) => v.id === saved.id)
            ? values.map((v) => (v.id === saved.id ? saved : v))
            : [...values, saved],
        );
        const continueAdding =
          addAnother && form.id === 'new' && services.length + 1 < 20;
        setForm(
          continueAdding
            ? { id: 'new', draft: fresh(saved.provider), dirty: true }
            : formFor(saved.id, saved),
        );
        setNotice(
          continueAdding
            ? `「${saved.name}」已加入左侧列表，可继续填写下一份识别服务。`
            : '识别服务已保存。可从左侧添加更多服务，或开始录音试用当前服务。',
        );
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : '识别服务操作失败。');
    } finally {
      if (!abort.signal.aborted) setSaving(false);
    }
  };
  return {
    services,
    ...form,
    selected: services.find((v) => v.id === form.id),
    loading,
    saving,
    loaded,
    error,
    notice,
    choose,
    change,
    changeProvider: (provider: 'bailian' | 'whisper') => {
      if (form.id !== 'new') return;
      setForm({ id: 'new', draft: fresh(provider), dirty: true });
      setError('');
      setNotice('');
    },
    save: (addAnother = false) => mutate(false, addAnother),
    remove: () => mutate(true),
    reload: () => setRetry((n) => n + 1),
  };
}
