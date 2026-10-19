import { useState, useRef, useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { clearGatewayToken, saveGatewayToken } from '../../network/gateway';

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
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const connecting = !!savedToken && status !== 'unauthorized';

  useEffect(() => {
    if (!showHelp) return;
    const onMouseDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelp(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showHelp]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('pnpm agent:ctl auth show');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
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
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          WORLD CONSOLE
        </h2>
        <button
          type="button"
          className="console-locked-close"
          aria-label="关闭"
          onClick={onClose}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="console-access">
        {connecting ? (
          <div className="console-access-pending">
            <p role="status">正在连接控制台…</p>
            <Button onClick={clearGatewayToken}>更换令牌</Button>
          </div>
        ) : (
          <form
            className="console-access-form"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = token.trim();
              if (!trimmed) return;
              saveGatewayToken(trimmed);
              setToken('');
            }}
          >
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
              <Button type="submit" className="primary" disabled={!token.trim()}>
                解锁
              </Button>
            </div>

            {error && (
              <p className="console-locked-error" role="alert">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <circle cx="12" cy="16" r=".6" fill="currentColor" stroke="none" />
                </svg>
                {error}
              </p>
            )}

            <div className="console-access-meta">
              <span className="console-access-hint">
                仅当前标签页有效
              </span>

              <div className="console-help-popover-wrap" ref={helpRef}>
                <button
                  type="button"
                  className={`console-help-icon-btn${showHelp ? ' active' : ''}`}
                  title="如何获取管理员令牌？"
                  aria-label="如何获取管理员令牌？"
                  aria-expanded={showHelp}
                  aria-haspopup="dialog"
                  onClick={() => setShowHelp((prev) => !prev)}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" />
                    <circle
                      cx="12"
                      cy="16.5"
                      r=".8"
                      fill="currentColor"
                      stroke="none"
                    />
                  </svg>
                </button>

                {showHelp && (
                  <div
                    className="console-token-popover"
                    role="tooltip"
                    aria-label="获取令牌说明"
                  >
                    <div className="console-token-popover-header">
                      <span className="console-token-popover-title">
                        获取管理员令牌
                      </span>
                      <button
                        type="button"
                        className="console-token-popover-close"
                        aria-label="关闭提示"
                        onClick={() => setShowHelp(false)}
                      >
                        ×
                      </button>
                    </div>

                    <div className="console-token-popover-section">
                      <span className="console-token-popover-sub">
                        本机开发环境
                      </span>
                      <div className="console-token-cmd-box">
                        <code>pnpm agent:ctl auth show</code>
                        <button
                          type="button"
                          className={`console-token-copy-btn${copied ? ' copied' : ''}`}
                          onClick={handleCopy}
                        >
                          {copied ? '已复制 ✓' : '复制'}
                        </button>
                      </div>
                    </div>

                    <p className="console-token-popover-footer">
                      若非本机运行，请联系服务器管理员获取。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}



