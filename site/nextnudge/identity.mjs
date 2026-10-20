export const ID = /^(PRJ|NN|GF|EV)-\d{8}-\d{6}-[a-f0-9]{4}$/;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const now = () => new Date().toISOString();
export function id(prefix, existing = {}) {
  const used = JSON.stringify(existing);
  for (let attempt = 0; attempt < 100; attempt++) {
    const clock = now().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(-4);
    const candidate = `${prefix}-${clock}-${suffix}`;
    if (!used.includes(candidate)) return candidate;
  }
  throw Error('Could not allocate a unique identifier. Try again.');
}
export const safeURL = value => value === '' || /^https?:\/\/[^\s]+$/i.test(value);
export function utc(value) {
  if (!value) return null;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw Error('Invalid reply time.');
  return time.toISOString();
}
