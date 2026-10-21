import { publicError } from '../management-error';
import express, { type RequestHandler } from 'express';
import { identifier } from '@voxel/shared/management';
import { AppError } from '../errors';
import { requireJsonRequest } from './require-json';
import { errorHandler } from './error-handler';

const validateIdempotencyKey: RequestHandler = (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (key !== undefined && !identifier(key)) {
    res.status(400).json({ error: 'Idempotency-Key 无效。' });
    return;
  }
  next();
};

/** Shared management transport policy; authentication is supplied by composition. */
export const managementBody = [
  validateIdempotencyKey,
  requireJsonRequest,
  express.json({ limit: '32kb' }),
];

export const managementErrors = errorHandler((error) => {
  if (error instanceof AppError)
    return { status: error.status, body: { error: error.message } };
  if (
    error?.type === 'entity.too.large' ||
    error?.type === 'entity.parse.failed'
  )
    return {
      status: error?.type === 'entity.too.large' ? 413 : 400,
      body: { error: '无法处理请求，请检查输入或本机配置文件权限。' },
    };
  const e = publicError(error);
  return { status: e.status, body: { error: e.message } };
});
