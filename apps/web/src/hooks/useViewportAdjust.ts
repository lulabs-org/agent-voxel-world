import { useEffect, useRef, useState } from 'react';
export function useViewportAdjust() {
  const [narrow, setNarrow] = useState(
    () => matchMedia('(max-width: 899px)').matches,
  );
  const [shortViewport, setShortViewport] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 899px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    const viewport = window.visualViewport;
    const resize = () => {
      setShortViewport((viewport?.height ?? innerHeight) < 560);
      mainRef.current?.style.setProperty(
        '--hud-height',
        `${viewport?.height ?? innerHeight}px`,
      );
      mainRef.current?.style.setProperty(
        '--hud-top',
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      query.removeEventListener('change', update);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
    };
  }, []);
  return { narrow, shortViewport, mainRef };
}
