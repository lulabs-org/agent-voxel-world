/** Revision preconditions guard execution; retries retain the original receipt. */
export function taskCommandBody(value: any) {
  const {
    expectedTask: _task,
    expectedPlanRevision: _plan,
    ...body
  } = value ?? {};
  return body;
}
