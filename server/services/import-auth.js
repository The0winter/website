import crypto from 'node:crypto';

export function validImportCredential(req) {
  const supplied = req.headers['x-import-secret'], expected = process.env.IMPORT_SECRET;
  return typeof supplied === 'string' && typeof expected === 'string' && expected.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

// req.path is relative to /api here. Forwarded IP headers cannot grant access.
export function trustedLocalImport(req) {
  return req.method === 'POST' && ['/admin/upload-book', '/admin/check-sync'].includes(req.path) &&
    !req.headers.origin && !req.headers.cookie && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers.forwarded &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && validImportCredential(req);
}
