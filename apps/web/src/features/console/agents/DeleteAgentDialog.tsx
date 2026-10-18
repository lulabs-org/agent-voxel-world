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
      <h3 id={titleId}>删除“{name}”？</h3>
      <div id={descriptionId}>
        <p>
          将停止运行，并永久删除角色设置、任务计划和运行记录。此操作无法撤销。
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
