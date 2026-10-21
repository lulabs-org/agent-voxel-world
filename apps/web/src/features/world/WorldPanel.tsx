import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Connection } from '../../network/connection';
import { PresenceSubscription } from '../../network/world-presence';

export function WorldPanel({
  connection,
  hidden = false,
  onClose,
}: {
  connection: Connection;
  hidden?: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [presence] = useState(() => new PresenceSubscription());
  const [, render] = useState(0);
  useEffect(() => {
    presence.onChange = () => render((n) => n + 1);
    presence.start();
    return () => presence.stop();
  }, [presence]);
  const { data, status } = presence;
  const players = data?.players ?? [];
  const humans = players.filter(
    (p) => p.connected && p.kind !== 'scripted-agent' && p.kind !== 'ai-agent',
  ).length;
  const agents = players.filter(
    (p) =>
      p.connected && (p.kind === 'scripted-agent' || p.kind === 'ai-agent'),
  ).length;
  const reconnecting = players.filter((p) => !p.connected).length;
  const selfId =
    connection.status === 'connected' ? connection.room?.sessionId : undefined;
  return (
    <aside
      id="world-panel"
      className="panel world-panel"
      aria-label={t('worldPanel.ariaLabel')}
      hidden={hidden}
    >
      {onClose && (
        <button
          className="panel-close"
          aria-label={t('worldPanel.closeAria')}
          onClick={onClose}
        >
          {t('worldPanel.collapse')}
        </button>
      )}
      <div className="eyebrow">{t('worldPanel.eyebrow')}</div>
      <h1>{t('worldPanel.title')}</h1>
      <div className={`presence-status ${status}`} role="status">
        <i />
        {status === 'live'
          ? t('worldPanel.statusLive')
          : status === 'loading'
            ? t('worldPanel.statusLoading')
            : t('worldPanel.statusReconnecting')}
      </div>
      {status === 'reconnecting' && (
        <p className="presence-notice">
          {data
            ? t('worldPanel.reconnectingWithData')
            : t('worldPanel.reconnectingNoData')}
        </p>
      )}
      <div className="stats">
        <div>
          <strong>{data ? humans : '—'}</strong>
          <small>{t('worldPanel.onlineHumans')}</small>
        </div>
        <div>
          <strong>{data ? agents : '—'}</strong>
          <small>{t('worldPanel.onlineAgents')}</small>
        </div>
      </div>
      <p className="world-occupancy">
        {data
          ? t('worldPanel.occupancy', {
              count: humans + agents,
              capacity: data.capacity,
              reconnecting,
            })
          : t('worldPanel.waitingPlayerList')}
      </p>
      <div className="rule" />
      <div className="eyebrow">{t('worldPanel.playerList')}</div>
      <div className="player-list">
        {players.map((p) => (
          <div className={`player ${p.connected ? '' : 'away'}`} key={p.id}>
            <div className="player-name">
              <span aria-hidden="true">
                {p.kind === 'scripted-agent' || p.kind === 'ai-agent'
                  ? '◆'
                  : '●'}
              </span>
              {p.name}
              {p.id === selfId ? t('worldPanel.you') : ''}
            </div>
            <small>
              {p.kind === 'ai-agent'
                ? t('worldPanel.aiAgent')
                : p.kind === 'scripted-agent'
                  ? t('worldPanel.scriptedAgent')
                  : t('worldPanel.player')}{' '}
              ·{' '}
              {p.connected
                ? t('worldPanel.online')
                : t('worldPanel.reconnecting')}
            </small>
            <small className="player-position">
              {t('worldPanel.position', {
                x: p.x.toFixed(1),
                y: p.y.toFixed(1),
                z: p.z.toFixed(1),
              })}
            </small>
          </div>
        ))}
        {data && players.length === 0 && (
          <p>
            {status === 'live'
              ? t('worldPanel.noPlayersLive')
              : t('worldPanel.noPlayersCached')}
          </p>
        )}
      </div>
      <div className="world-membership">
        {connection.status === 'connected'
          ? t('worldPanel.memberConnected')
          : connection.status === 'lobby'
            ? t('worldPanel.memberLobby')
            : t('worldPanel.memberReconnecting')}
      </div>
      <div className="storage">
        {t('worldPanel.worldVersion', {
          revision: data?.revision ?? '—',
          storage: data
            ? data.persistence === 'memory'
              ? t('worldPanel.storageMemory')
              : t('worldPanel.storageDatabase')
            : t('worldPanel.storageWaiting'),
        })}
      </div>
    </aside>
  );
}

