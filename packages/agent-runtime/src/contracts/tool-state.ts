export type ToolState = {
  terminal: boolean;
  skipBatch: boolean;
  hadError: boolean;
  persistenceFailed: boolean;
  turnMutated: boolean;
};

export const initialToolState = (): ToolState => ({
  terminal: false,
  skipBatch: false,
  hadError: false,
  persistenceFailed: false,
  turnMutated: false,
});
