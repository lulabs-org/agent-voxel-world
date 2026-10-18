import { AppError } from '../../common/errors';
export class ChatError extends AppError {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message, status);
  }
}
