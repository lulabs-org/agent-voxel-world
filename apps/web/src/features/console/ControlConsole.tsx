import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import {
  openGateway,
  closeGateway,
  gatewayState,
  onGatewayState,
  clearGatewayToken,
  getGatewayToken,
  gatewayError,
} from '../../network/gateway';
import { TaskPlans } from './tasks/TaskPlans';
import { GatewayAccess } from './GatewayAccess';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import type { Connection } from '../../network/connection';
import { SpeechRecognitionPanel } from '../voice';
import { AICharacterList } from './ai-characters/AICharacterList';
import { ConsoleHelp } from './ConsoleHelp';
import { ProviderEditor } from './providers/ProviderEditor';
import { useConsoleController } from './useConsoleController';
import { VoiceServices } from './voice/VoiceServices';
type ConsoleProps = {
  connection: Connection;
  open: boolean;
  initialTab?: 'characters';
  onClose: () => void;
};
export function ControlConsole({
  connection,
  open,
  initialTab,
  onClose,
}: ConsoleProps) {
  const status = useSyncExternalStore(onGatewayState, gatewayState);
  const gatewayFailure = useSyncExternalStore(onGatewayState, gatewayError);
  const savedToken = useSyncExternalStore(onGatewayState, getGatewayToken);
  const [hasConnected, setHasConnected] = useState(false);
  const locked = !savedToken || status === 'unauthorized' || !hasConnected;
  useEffect(() => {
    if (!savedToken || status === 'unauthorized') setHasConnected(false);
    else if (status === 'ready') setHasConnected(true);
  }, [savedToken, status]);
  useEffect(() => {
    if (open) openGateway();
    return () => closeGateway();
  }, [open]);
  const controller = useConsoleController(
    open && status === 'ready',
    initialTab,
  );
  const {
    tab,
    setTab,
    providers,
    body,
    notice,
    setNotice,
    error,
    setError,
    selected,
    editProvider,
  } = controller;

  if (locked) {
    return (
      <GatewayAccess
        open={open}
        status={status}
        savedToken={savedToken}
        error={gatewayFailure}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      open={open}
      id="control-console"
      className="agent-dialog"
      aria-labelledby="agent-title"
      onCancel={onClose}
    >
      <div className="agent-chrome">
        <div className="agent-heading">
          <div>
            <div className="eyebrow">WORLD CONSOLE</div>
            <div className="console-title-row">
              <h2 id="agent-title">控制台</h2>
              <span
                role="status"
                className={`console-status-pill ${status === 'ready' ? 'console-connected' : 'console-reconnecting'}`}
              >
                {status === 'ready' ? '已连接' : '连接中断，正在重新同步…'}
              </span>
            </div>
            <p>管理 AI 角色、连接模型服务，设置语音交流。</p>
          </div>
          <div className="console-heading-actions">
            <Button className="console-exit-btn" onClick={clearGatewayToken}>
              退出管理
            </Button>
            <ConsoleHelp />
            <Button aria-label="关闭控制台" onClick={onClose}>
              关闭 ×
            </Button>
          </div>
        </div>
        {gatewayFailure && (
          <p className="agent-error" role="alert">
            {gatewayFailure}
          </p>
        )}
        <nav className="agent-tabs" aria-label="控制台分类">
          <button
            aria-pressed={tab === 'characters'}
            onClick={() => {
              setTab('characters');
              setError('');
              setNotice('');
            }}
          >
            AI 角色
          </button>
          <button
            aria-pressed={tab === 'plans'}
            onClick={() => setTab('plans')}
          >
            任务计划
          </button>
          <button
            aria-pressed={tab === 'providers'}
            onClick={() => {
              setTab('providers');
              editProvider(selected ?? providers[0]);
            }}
          >
            模型服务
          </button>
          <button
            aria-pressed={tab === 'voice'}
            onClick={() => setTab('voice')}
          >
            文本转语音（TTS）
          </button>
          <button aria-pressed={tab === 'asr'} onClick={() => setTab('asr')}>
            语音识别（ASR）
          </button>
        </nav>
      </div>
      <div className="agent-body" ref={body}>
        <fieldset
          disabled={status !== 'ready'}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div hidden={tab !== 'plans'}>
            <TaskPlans
              characters={controller.jobs}
              active={open && status === 'ready' && tab === 'plans'}
              disabled={status !== 'ready'}
            />
          </div>
          <div className="console-voice" hidden={tab !== 'voice'}>
            <VoiceServices
              services={controller.voiceServices}
              onChange={controller.setVoiceServices}
              active={open && status === 'ready' && tab === 'voice'}
            />
          </div>
          <div className="console-voice" hidden={tab !== 'asr'}>
            <SpeechRecognitionPanel
              connection={connection}
              active={open && status === 'ready' && tab === 'asr'}
            />
          </div>
          <div hidden={tab === 'voice' || tab === 'asr' || tab === 'plans'}>
            {tab === 'providers' ? (
              <ProviderEditor {...controller} />
            ) : (
              <AICharacterList
                {...controller}
                active={open && status === 'ready' && tab === 'characters'}
              />
            )}
          </div>
        </fieldset>
      </div>

      {(notice || error) && (
        <div className="console-toast-wrapper" aria-live="polite">
          {notice && (
            <div className="console-toast console-toast-notice" role="status">
              <CheckCircle2 size={16} className="console-toast-icon" />
              <span className="console-toast-message">{notice}</span>
              <button
                type="button"
                className="console-toast-dismiss"
                onClick={() => setNotice('')}
                aria-label="关闭提示"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="console-toast console-toast-error" role="alert">
              <AlertCircle size={16} className="console-toast-icon" />
              <span className="console-toast-message">{error}</span>
              <button
                type="button"
                className="console-toast-dismiss"
                onClick={() => setError('')}
                aria-label="关闭错误"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
