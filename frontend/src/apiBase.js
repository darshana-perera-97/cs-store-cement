export function getApiBase() {
  const fromEnv = (process.env.REACT_APP_API_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:1248';
  }
  return '';
}
