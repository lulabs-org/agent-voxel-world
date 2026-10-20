import type { RequestHandler } from 'express';
export function originAllowed(
  origin: string | undefined,
  allowed: string,
  required = true,
) {
  if (allowed === '*' || origin === allowed || (!required && !origin))
    return true;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    // Local development uses both names for the same IPv4 loopback service.
    // Keep the configured scheme and port boundary intact.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    else if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    else return false;
    return url.origin === allowed;
  } catch {
    return false;
  }
}
/** Share the mechanism while retaining each endpoint's origin/preflight policy. */
export function createOriginGuard(options: {
  origin: string;
  required?: boolean;
  message: string;
  crossSite?: boolean;
  vary?: boolean;
  cacheControl?: string;
  alwaysHeader?: boolean;
  methods?: string | ((path: string) => string);
  headers?: string;
}): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (
      !originAllowed(origin, options.origin, options.required ?? true) ||
      (options.crossSite && req.headers['sec-fetch-site'] === 'cross-site')
    ) {
      res.status(403).json({ error: options.message });
      return;
    }
    if (origin || options.alwaysHeader)
      res.header('Access-Control-Allow-Origin', origin ?? options.origin);
    if (options.vary) res.header('Vary', 'Origin');
    if (options.cacheControl) res.header('Cache-Control', options.cacheControl);
    if (req.method === 'OPTIONS' && options.methods) {
      res.header(
        'Access-Control-Allow-Methods',
        typeof options.methods === 'string'
          ? options.methods
          : options.methods(req.path),
      );
      res.header(
        'Access-Control-Allow-Headers',
        options.headers ?? 'Content-Type',
      );
      res.sendStatus(204);
      return;
    }
    next();
  };
}
