/** Request accounting seam implemented by the task budget and consumed by the model stream. */
export interface RequestAccounting {
  readonly usage: { calls: number; tokens: number; estimated: boolean };
  readonly remainingMs: number;
  begin(): number;
  finish(tokens: number, estimated: boolean): void;
  check(): void;
}
