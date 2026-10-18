import type { RequestHandler } from 'express';
export function originAllowed(
  origin: string | undefined,
  allowed: string,
  required = true,
) {
  return allowed === '*' || origin === allowed || (!required && !origin);
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
      res.header(
        'Access-Control-Allow-Origin',
        options.origin === '*' ? (origin ?? '*') : options.origin,
      );
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
