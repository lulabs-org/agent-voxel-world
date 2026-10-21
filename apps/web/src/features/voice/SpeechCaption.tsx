import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveSpeech } from '../../audio/spatial/agent-speech-playback';
import type { SpeechAnchor } from '../../graphics/speech-anchor';
import { speechPages } from './speech-caption-text';
import './speech-caption.css';

type Props = {
  speech: ActiveSpeech | undefined;
  anchor: (actor: string) => SpeechAnchor | null;
};

export function SpeechCaption({ speech, anchor }: Props) {
  return speech ? (
    <ActiveCaption key={speech.id} speech={speech} anchor={anchor} />
  ) : null;
}

function ActiveCaption({ speech, anchor }: Props & { speech: ActiveSpeech }) {
  const element = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => speechPages(speech.text), [speech.text]);
  const [page, setPage] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let frame = 0;
    let lastPage = -1;
    const update = () => {
      const node = element.current;
      if (!node) return;
      const now = Date.now();
      const elapsed = now - speech.startedAt;
      const index =
        speech.endedAt === undefined
          ? Math.min(
              pages.length - 1,
              Math.floor(
                (elapsed / Math.max(1, speech.durationMs)) * pages.length,
              ),
            )
          : pages.length - 1;
      if (index !== lastPage) {
        lastPage = index;
        setPage(index);
      }
      const tail = speech.endedAt === undefined ? 0 : now - speech.endedAt;
      node.style.opacity = String(
        Math.max(0, Math.min(1, (2200 - tail) / 400)),
      );
      if (tail >= 2200) {
        setExpired(true);
        return;
      }
      const point = anchor(speech.actor);
      const bubbleWidth = node.offsetWidth;
      const bubbleHeight = node.offsetHeight;
      // Leave room for the header and bottom controls. When out of bounds, hide the bubble.
      const overhead =
        point && point.y - bubbleHeight >= 70 && point.y < point.height - 140;
      node.dataset.placement = overhead ? 'overhead' : 'hidden';
      if (overhead) {
        const x = Math.max(
          16 + bubbleWidth / 2,
          Math.min(point.width - 16 - bubbleWidth / 2, point.x),
        );
        node.style.left = `${x}px`;
        node.style.top = `${point.y}px`;
        node.style.setProperty('--speech-tip', `${point.x - x}px`);
      } else {
        node.style.removeProperty('left');
        node.style.removeProperty('top');
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [speech, anchor, pages]);
  if (expired) return null;
  return (
    <div
      ref={element}
      className="speech-caption"
      data-placement="hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="speech-caption-heading">
        <strong>{speech.name}</strong>
        <span>{speech.scope === 'private' ? '私聊' : '附近语音'}</span>
        {pages.length > 1 && (
          <span className="speech-caption-page">
            {page + 1}/{pages.length}
          </span>
        )}
      </div>
      <p>{pages[page]}</p>
    </div>
  );
}
