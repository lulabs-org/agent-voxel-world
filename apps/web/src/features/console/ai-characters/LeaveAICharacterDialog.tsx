import { useId, useRef } from 'react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useI18n } from '../../../i18n';

export function LeaveAICharacterDialog({
    name,
    busy,
    disabled,
    onCancel,
    onConfirm,
}: {
    name: string;
    busy: boolean;
    disabled: boolean;
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
            <h3 id={titleId}>{t('console.characters.confirmLeaveTitle', { name })}</h3>
            <p id={descriptionId}>{t('console.characters.confirmLeaveDesc')}</p>
            <div className="agents-actions">
                <Button ref={cancel} disabled={busy} onClick={onCancel}>
                    {t('common.cancel')}
                </Button>
                <Button disabled={disabled} onClick={onConfirm}>
                    {t('console.characters.confirmLeaveButton')}
                </Button>
            </div>
        </Dialog>
    );
}
