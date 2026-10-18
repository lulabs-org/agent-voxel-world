import { AppError } from '../../common/errors';
export class ManagementError extends AppError {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message, status);
  }
}
export class TaskPlanError extends AppError {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message, status);
  }
}
