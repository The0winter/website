import crypto from 'node:crypto';
import UsernameReservation from '../models/UsernameReservation.js';
import User from '../models/User.js';

export const normalizeUsername = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu,' ');
export const usernameKey = value => crypto.createHash('sha256').update(normalizeUsername(value).toLowerCase()).digest('hex');
export const usernameTakenMessage = '该用户名已被使用，请换一个';

export async function usernameTaken(username) {
  return Boolean(await UsernameReservation.exists({_id:usernameKey(username)}) || await User.exists({username}));
}
