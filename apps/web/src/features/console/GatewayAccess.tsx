import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { clearGatewayToken, saveGatewayToken } from '../../network/gateway';

export function GatewayAccess({
  status,
  savedToken,
  error,
}: {
  status: string;
  savedToken: string;
  error: string;
}) {
  const [token, setToken] = useState('');
  const connecting = !!savedToken && status !== 'unauthorized';
  return (
    <div className="console-access">
      <div className="console-access-icon" aria-hidden="true">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5" y="10" width="14" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </svg>
      </div>
      <h3>{connecting ? '正在连接控制台' : '解锁管理功能'}</h3>
      <p className="console-access-description">
        {connecting
          ? '连接并同步最新状态后，即可开始管理。'
          : '输入管理员令牌以继续。普通游戏与聊天无需解锁。'}
      </p>
      {error && (
        <p className="agent-error" role="alert">
          {error}
        </p>
      )}
      {connecting ? (
        <div className="console-access-pending">
          <p role="status">正在连接…</p>
          <Button onClick={clearGatewayToken}>更换令牌</Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!token.trim()) return;
            saveGatewayToken(token);
            setToken('');
          }}
        >
          <label htmlFor="console-admin-token">管理员令牌</label>
          <input
            id="console-admin-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            placeholder="粘贴管理员令牌"
            required
            aria-describedby="console-token-note"
          />
          <Button type="submit" className="primary" disabled={!token.trim()}>
            解锁控制台
          </Button>
          <p id="console-token-note" className="console-access-note">
            仅在当前标签页保存，退出管理后清除。
          </p>
        </form>
      )}
      <details className="console-access-help">
        <summary>如何获取管理员令牌？</summary>
        <p>
          向服务管理员获取。若服务运行在本机，可在项目目录执行{' '}
          <code>pnpm agent:ctl auth show</code>，读取本地令牌文件。
        </p>
      </details>
    </div>
  );
}
