import { useState } from 'react';
import { Lock, X, AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { clearGatewayToken, saveGatewayToken } from '../../network/gateway';
import { TokenHelpPopover } from './TokenHelpPopover';

export function GatewayAccess({
  open,
  status,
  savedToken,
  error,
  onClose,
}: {
  open: boolean;
  status: string;
  savedToken: string;
  error: string;
  onClose: () => void;
}) {
  const [token, setToken] = useState('');
  const connecting = !!savedToken && status !== 'unauthorized';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    saveGatewayToken(trimmed);
    setToken('');
  };

  return (
    <Dialog
      open={open}
      id="control-console-auth"
      className="agent-dialog console-locked"
      aria-labelledby="console-auth-title"
      onCancel={onClose}
    >
      <div className="console-locked-header">
        <h2 id="console-auth-title" className="console-locked-title">
          <Lock size={12} strokeWidth={2.4} />
          WORLD CONSOLE
        </h2>
        <button
          type="button"
          className="console-locked-close"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="console-access">
        {connecting ? (
          <div className="console-access-pending">
            <p role="status">正在连接控制台…</p>
            <Button onClick={clearGatewayToken}>更换令牌</Button>
          </div>
        ) : (
          <form className="console-access-form" onSubmit={handleSubmit}>
            <div className="console-access-input-group">
              <input
                id="console-admin-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                placeholder="输入管理员令牌…"
                autoFocus
                required
                aria-label="管理员令牌"
                aria-invalid={!!error}
              />
              <Button
                type="submit"
                className="primary"
                disabled={!token.trim()}
              >
                解锁
              </Button>
            </div>

            {error && (
              <p className="console-locked-error" role="alert">
                <AlertCircle size={13} strokeWidth={2} />
                {error}
              </p>
            )}

            <div className="console-access-meta">
              <span className="console-access-hint">仅当前标签页有效</span>
              <TokenHelpPopover />
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
