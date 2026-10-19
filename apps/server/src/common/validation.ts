import { AppError } from './errors';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('请求格式无效。');
  return value as Record<string, unknown>;
}

export function text(
  value: unknown,
  label: string,
  max: number,
  fallback = '',
) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max)
    throw new AppError(`${label}格式无效。`);
  return value.trim();
}

export function integer(
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new AppError(`${label}须为 ${min}–${max} 的整数。`);
  return value;
}

export function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AppError('开关参数无效。');
  return value;
}
