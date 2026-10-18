import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors';
export type ErrorResponse = {
  status: number;
  body: { error: string; code?: string };
};
/** Domain formatters preserve existing HTTP contracts; streaming failures delegate after headers. */
export function errorHandler(
  format: (error: any) => ErrorResponse = (error) => ({
    status: error instanceof AppError ? error.status : 500,
    body: {
      error:
        error instanceof AppError
          ? error.message
          : '无法处理请求，请稍后重试。',
    },
  }),
): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const response = format(error);
    res.status(response.status).json(response.body);
  };
}
