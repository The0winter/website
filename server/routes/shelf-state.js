import {asyncRoute} from '../security.js';
import {readShelfState, saveShelfState} from '../services/shelf-state.js';
export function shelfStateRoutes(app, auth) {
  for (const method of ['get', 'put']) app[method]('/api/v1/me/bookshelf/:bookId', auth.authenticate, asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!/^[a-f0-9]{24}$/i.test(req.params.bookId)) return res.status(400).json({code: 'INVALID_BOOK', error: '作品ID无效'});
    try { res.json(method === 'get' ? await readShelfState(req.user.id, req.params.bookId) : await saveShelfState(req.user.id, req.params.bookId, req.body)); }
    catch (error) {
      if (!error.status || typeof error.code !== 'string') throw error;
      res.status(error.status).json({code: error.code, error: error.message, ...error.details});
    }
  }));
}
