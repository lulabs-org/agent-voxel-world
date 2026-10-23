export const dateInput = (at: number, zone: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
};
