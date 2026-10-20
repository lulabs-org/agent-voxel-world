import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewaySocketUrl, serverHttpUrl, serverSocketUrl } from './endpoints';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function page(url: string) {
  vi.stubEnv('VITE_SERVER_URL', '');
  vi.stubGlobal('window', { location: new URL(url) });
}

describe('server endpoints', () => {
  it.each(['localhost', '127.0.0.1'])(
    'connects the %s dev page to the IPv4 dev server for every transport',
    (hostname) => {
      page(`http://${hostname}:5173/`);
      expect(serverSocketUrl()).toBe('ws://127.0.0.1:2567');
      expect(serverHttpUrl()).toBe('http://127.0.0.1:2567');
      expect(gatewaySocketUrl()).toBe(
        'ws://127.0.0.1:2567/ai-characters/gateway',
      );
    },
  );

  it('keeps a remote development host', () => {
    page('http://192.168.1.100:5173/');
    expect(serverSocketUrl()).toBe('ws://192.168.1.100:2567');
  });

  it.each([
    ['http://localhost/', 'ws://localhost'],
    ['https://world.example:8443/', 'wss://world.example:8443'],
  ])('keeps the deployed page origin for %s', (url, expected) => {
    page(url);
    expect(serverSocketUrl()).toBe(expected);
    expect(gatewaySocketUrl()).toBe(`${expected}/ai-characters/gateway`);
  });

  it('honors an explicit server URL even on a local dev page', () => {
    page('http://localhost:5173/');
    vi.stubEnv('VITE_SERVER_URL', 'wss://gateway.example');
    expect(serverSocketUrl()).toBe('wss://gateway.example');
    expect(serverHttpUrl()).toBe('https://gateway.example');
    expect(gatewaySocketUrl()).toBe(
      'wss://gateway.example/ai-characters/gateway',
    );
  });
});
