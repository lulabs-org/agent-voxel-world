import { useId, useRef } from 'react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

export function DeleteAgentDialog({
  name,
  busy,
  disabled,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  disabled: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open
      initialFocus={cancel}
      preventScroll
      className="agents-delete-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onCancel();
      }}
      onClose={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h3 id={titleId}>删除 AI 角色“{name}”？</h3>
      <div id={descriptionId}>
        <p>
          将删除 AI
          角色并取消未结束执行。计划与执行历史保留，未完成计划暂停并等待重新指派。AI
          角色删除无法撤销。
        </p>
        <p>已建造的方块、模型服务和语音服务会保留。</p>
      </div>
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
      <div className="agents-actions">
        <Button ref={cancel} disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button
          className="agents-delete-button"
          disabled={disabled}
          onClick={onConfirm}
        >
          {busy ? '正在删除…' : '确认删除'}
        </Button>
      </div>
    </Dialog>
  );
}
