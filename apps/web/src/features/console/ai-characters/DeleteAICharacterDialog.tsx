import { useId, useRef } from 'react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useI18n } from '../../../i18n';

export function DeleteAICharacterDialog({
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
  const { t } = useI18n();
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open
      initialFocus={cancel}
      preventScroll
      className="agents-delete-dialog"
      /* Nest above the console dialog (z 401): own backdrop 401, content 402. */
      overlayStyle={{ zIndex: 401 }}
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
      <h3 id={titleId}>
        {t('console.characters.deleteTitleWithName', { name })}
      </h3>
      <div id={descriptionId}>
        <p>{t('console.characters.deleteDesc1')}</p>
        <p>{t('console.characters.deleteDesc2')}</p>
      </div>
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
      <div className="agents-actions">
        <Button ref={cancel} disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          className="agents-delete-button"
          disabled={disabled}
          onClick={onConfirm}
        >
          {busy
            ? t('console.characters.deleting')
            : t('console.characters.confirmDelete')}
        </Button>
      </div>
    </Dialog>
  );
}
