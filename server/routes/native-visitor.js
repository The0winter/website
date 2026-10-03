import rateLimit from 'express-rate-limit';

export function nativeVisitorRoutes(app, auth) {
  app.post('/api/v1/visitor', rateLimit({windowMs: 60000, limit: 10,
    message: {code: 'RATE_LIMITED', error: '请求过于频繁，请稍后重试'}}), (req, res) => {
    res.set('Cache-Control', 'private, no-store').json(auth.visitor.issue());
  });
}
