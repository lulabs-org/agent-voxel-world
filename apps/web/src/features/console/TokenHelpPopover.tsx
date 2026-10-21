import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { HelpCircle, X, Copy, Check } from 'lucide-react';

const LOCAL_AUTH_CMD = 'pnpm agent:ctl auth show';

export function TokenHelpPopover() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(LOCAL_AUTH_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="console-help-icon-btn"
          title="如何获取管理员令牌？"
          aria-label="如何获取管理员令牌？"
        >
          <HelpCircle size={13} strokeWidth={2.2} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="console-token-popover"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <div className="console-token-popover-header">
            <span className="console-token-popover-title">获取管理员令牌</span>
            <Popover.Close asChild>
              <button
                type="button"
                className="console-token-popover-close"
                aria-label="关闭提示"
              >
                <X size={14} />
              </button>
            </Popover.Close>
          </div>

          <div className="console-token-popover-section">
            <span className="console-token-popover-sub">本机开发环境</span>
            <div className="console-token-cmd-box">
              <code>{LOCAL_AUTH_CMD}</code>
              <button
                type="button"
                className={`console-token-copy-btn${copied ? ' copied' : ''}`}
                onClick={() => void handleCopy()}
              >
                {copied ? (
                  <>
                    <Check size={12} /> 已复制
                  </>
                ) : (
                  <>
                    <Copy size={12} /> 复制
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="console-token-popover-footer">
            若非本机运行，请联系服务器管理员获取。
          </p>
          <Popover.Arrow
            className="console-token-popover-arrow"
            width={10}
            height={5}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
