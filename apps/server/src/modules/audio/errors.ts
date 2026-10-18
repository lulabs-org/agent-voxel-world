import { AppError } from '../../common/errors';
export class SpeechError extends AppError {
  constructor(
    message: string,
    public status = 400,
    public code?: 'no-speech',
  ) {
    super(message, status, code);
  }
}
