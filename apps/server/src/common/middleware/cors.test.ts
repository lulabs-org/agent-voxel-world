import { describe, expect, it, vi } from 'vitest';
import { createOriginGuard, originAllowed } from './cors';

describe('local page origins', () => {
  it.each([
    ['http://localhost:5173', 'http://127.0.0.1:5173'],
    ['http://127.0.0.1:5173', 'http://localhost:5173'],
  ])('accepts %s as the loopback alias of %s', (origin, allowed) => {
    expect(originAllowed(origin, allowed)).toBe(true);
  });

  it.each([
    undefined,
    'null',
    'http://localhost:5174',
    'https://localhost:5173',
    'http://localhost:5173/path',
    'http://localhost.evil.example:5173',
    'http://192.168.1.100:5173',
  ])('rejects an unexpected origin: %s', (origin) => {
    expect(originAllowed(origin, 'http://127.0.0.1:5173')).toBe(false);
  });

  it('retains missing-origin and wildcard policies', () => {
    expect(originAllowed(undefined, 'http://127.0.0.1:5173', false)).toBe(true);
    expect(originAllowed('https://example.com', '*')).toBe(true);
    expect(
      originAllowed('http://localhost:5173', 'https://world.example'),
    ).toBe(false);
  });

  it('echoes the accepted alias in preflight headers', () => {
    const header = vi.fn(),
      sendStatus = vi.fn(),
      next = vi.fn();
    createOriginGuard({
      origin: 'http://127.0.0.1:5173',
      message: 'Forbidden',
      vary: true,
      methods: 'GET, OPTIONS',
    })(
      {
        headers: { origin: 'http://localhost:5173' },
        method: 'OPTIONS',
      } as any,
      { header, sendStatus } as any,
      next,
    );
    expect(header).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://localhost:5173',
    );
    expect(header).toHaveBeenCalledWith('Vary', 'Origin');
    expect(sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });
});
