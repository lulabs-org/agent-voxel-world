import type { AICharacterLogEntry } from '@voxel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../i18n/context';
import { aiCharactersApi } from '../api';
export function useAICharacterLogs(characterId: string) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AICharacterLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setError('');
    try {
      const page = await aiCharactersApi.getLogs(characterId);
      if (id !== requestId.current) return;
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      if (id === requestId.current)
        setError(t('console.characters.logsLoadFailed'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [characterId, t]);

  useEffect(() => {
    const activeRequest = requestId;
    void loadFirstPage();
    return () => {
      activeRequest.current++;
    };
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!nextCursor || loading || loadingMoreRef.current) return;
    const id = requestId.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await aiCharactersApi.getLogs(characterId, nextCursor);
      if (id !== requestId.current) return;
      setEntries((list) => [...list, ...page.entries]);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      if (id === requestId.current) setLoadMoreError(true);
    } finally {
      if (id === requestId.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  return {
    entries,
    nextCursor,
    total,
    loading,
    loadingMore,
    loadMoreError,
    error,
    loadFirstPage,
    loadMore,
  };
}
