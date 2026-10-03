import crypto from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import NativeSession from '../models/NativeSession.js';
import VerificationCode from '../models/VerificationCode.js';
import UsernameReservation from '../models/UsernameReservation.js';
import {normalizeUsername,usernameKey,usernameTaken,usernameTakenMessage} from '../services/username-identity.js';
import sendMail from '../utils/sendEmail.js';
import { asyncRoute, publicUser } from '../security.js';

const validPassword = p => typeof p === 'string' && p.length >= 8 && Buffer.byteLength(p,'utf8') <= 72;
const digest = (email,code,secret) => crypto.createHmac('sha256',secret).update(email+'\0signup\0'+code).digest('hex');
export function authRoutes(app,auth,config,{prefix='/api/auth',native=false}={}) {
  app.post(native ? [`${prefix}/send-code`, `${prefix}/register-code`] : `${prefix}/send-code`,asyncRoute(async(req,res) => {
    const {email} = req.body;
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'邮箱格式无效'});
    const now = new Date();
    const code = String(crypto.randomInt(100000,1000000));
    // Unique email plus conditional update reserves the send slot before external work.
    let record;
    try {
      record = await VerificationCode.findOneAndUpdate({email,$or:[{lastSentAt:{$lte:new Date(+now-60000)},sendCount:{$lt:5}},{createdAt:{$lte:new Date(+now-3600000)}}]},[
        {$set:{email,code:digest(email,code,config.jwtSecret),purpose:'signup',attempts:0,consumed:false,expiresAt:new Date(+now+300000),lastSentAt:now,sendCount:{$cond:[{$lte:[{$ifNull:['$createdAt',new Date(0)]},new Date(+now-3600000)]},1,{$add:[{$ifNull:['$sendCount',0]},1]}]},createdAt:{$cond:[{$lte:[{$ifNull:['$createdAt',new Date(0)]},new Date(+now-3600000)]},now,'$createdAt']}}}
      ],{new:true,upsert:true});
    } catch(e) { if (e.code === 11000) return res.status(429).json({error:'发送过于频繁，请稍后再试'}); throw e; }
    try { await sendMail(email,code); }
    catch { await VerificationCode.updateOne({_id:record._id,code:record.code},{$set:{expiresAt:new Date(0),lastSentAt:new Date(0)},$inc:{sendCount:-1}}); return res.status(503).json({error:'邮件发送失败，请重试'}); }
    res.json({message:'验证码已发送'});
  }));
  app.post(native ? [`${prefix}/signup`, `${prefix}/register`] : `${prefix}/signup`,asyncRoute(async(req,res) => {
    const {email,password,code} = req.body;
    if (typeof email !== 'string' || typeof req.body.username !== 'string' || !validPassword(password) || typeof code !== 'string') return res.status(400).json({error:'请检查用户名、验证码及密码（8字符以上，最多72字节）'});
    const username=normalizeUsername(req.body.username);
    if (!username || username.length>40) return res.status(400).json({error:'用户名须为 1–40 个字符'});
    if (await usernameTaken(username)) return res.status(409).json({error:usernameTakenMessage});
    const hash = await bcrypt.hash(password,12);
    const record = await VerificationCode.findOneAndUpdate({email,consumed:false,expiresAt:{$gt:new Date()},attempts:{$lt:5}},{$inc:{attempts:1}},{new:true});
    if (!record || record.code !== digest(email,code,config.jwtSecret)) return res.status(400).json({error:'验证码错误或已过期'});
    if (await User.exists({email})) return res.status(409).json({error:'该邮箱已注册，请直接登录'});
    let user;
    try { await mongoose.connection.transaction(async session => {
      await UsernameReservation.create([{_id:usernameKey(username)}],{session});
      const consumed = await VerificationCode.updateOne({_id:record._id,code:record.code,consumed:false,expiresAt:{$gt:new Date()}},{$set:{consumed:true}},{session});
      if (!consumed.modifiedCount) { const e = new Error('验证码已使用'); e.status=409; throw e; }
      [user] = await User.create([{email,username,password:hash,role:'reader'}],{session});
    }); } catch(error) {
      if (error.code!==11000) throw error;
      return res.status(409).json({error:await usernameTaken(username) ? usernameTakenMessage : '该邮箱已注册，请直接登录'});
    }
    const tokens = await auth.issue(res,user);
    res.status(201).json({...tokens,user:{...publicUser(user),email:user.email},profile:publicUser(user)});
  }));
  app.post(native ? `${prefix}/login` : `${prefix}/signin`,asyncRoute(async(req,res) => {
    const identifier = req.body.email || req.body.username;
    const password = req.body.password;
    if (typeof identifier !== 'string' || typeof password !== 'string' || Buffer.byteLength(password)>72) return res.status(400).json({error:'账号或密码无效'});
    let user = await User.findOne({$or:[{email:identifier},{username:identifier}]});
    if(!user&&normalizeUsername(identifier)!==identifier)user=await User.findOne({username:normalizeUsername(identifier)});
    if (!user) return res.status(401).json({error:'账号或密码错误'});
    if (user.isTestAccount) return res.status(403).json({error:'测试展示账号不提供登录'});
    const now = Date.now();
    await User.updateOne({_id:user._id,lockUntil:{$gt:0,$lte:now}},{$set:{loginAttempts:0},$unset:{lockUntil:1}});
    user = await User.findById(user._id);
    if (user.isBanned || user.lockUntil > now) return res.status(403).json({error:'账户被封禁或锁定'});
    if (!await bcrypt.compare(password,user.password)) {
      await User.updateOne({_id:user._id},[{$set:{loginAttempts:{$add:[{$ifNull:['$loginAttempts',0]},1]}}},{$set:{lockUntil:{$cond:[{$gte:['$loginAttempts',5]},now+3600000,{$ifNull:['$lockUntil',0]}]}}}]);
      return res.status(401).json({error:'账号或密码错误'});
    }
    const current = await User.findOneAndUpdate({_id:user._id,password:user.password,isBanned:{$ne:true},$or:[{lockUntil:{$exists:false}},{lockUntil:{$lte:now}}]},{$set:{loginAttempts:0},$unset:{lockUntil:1}},{new:true});
    if (!current) return res.status(403).json({error:'账户状态已变更'});
    const tokens = await auth.issue(res,current);
    res.json({...tokens,user:{...publicUser(current),email:current.email},profile:publicUser(current)});
  }));
  app.get(native ? `${prefix}/me` : `${prefix}/session`,auth.authenticate,(req,res) => { res.set('Cache-Control','no-store'); res.json({user:{...publicUser(req.account),email:req.account.email},profile:publicUser(req.account)}); });
  if (!native) app.post(`${prefix}/activity`,auth.authenticate,asyncRoute(async(req,res) => {
    res.set('Cache-Control','private, no-store');
    res.json(await auth.renew(req,res));
  }));
  app.post(`${prefix}/logout`,auth.authenticate,asyncRoute(async(req,res) => { if (native) await auth.revoke(req.sessionId); else await Session.deleteOne({_id:req.sessionId}); auth.clear(res); res.json({success:true}); }));
  app.post(`${prefix}/change-password`,auth.authenticate,asyncRoute(async(req,res) => {
    const {oldPassword,newPassword} = req.body;
    if (typeof oldPassword !== 'string' || !validPassword(newPassword) || !await bcrypt.compare(oldPassword,req.account.password)) return res.status(400).json({error:'旧密码错误或新密码不符合要求'});
    const hash = await bcrypt.hash(newPassword,12);
    await mongoose.connection.transaction(async session => {
      const changed = await User.updateOne({_id:req.user.id,password:req.account.password},{$set:{password:hash},$inc:{authVersion:1}},{session});
      if (!changed.modifiedCount) { const e=new Error('密码已变更，请重新登录');e.status=409;throw e; }
      await Session.deleteMany({userId:req.user.id},{session});
      await NativeSession.deleteMany({userId:req.user.id},{session});
    });
    auth.clear(res);res.json({success:true});
  }));
}
