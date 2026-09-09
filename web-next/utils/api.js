export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') return '/api';
  const url = process.env.INTERNAL_API_URL;
  if (!url) throw new Error('INTERNAL_API_URL is required');
  return url.replace(/\/+$/, '');
};
