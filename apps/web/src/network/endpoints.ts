/** Shared transport addresses; evaluate lazily so previews and tests can override env. */
export const serverSocketUrl = () => {
  if (import.meta.env?.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.port === '5173') {
      return `ws://${window.location.hostname}:2567`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  return 'ws://127.0.0.1:2567';
};

export const serverHttpUrl = () => serverSocketUrl().replace(/^ws/, 'http');
