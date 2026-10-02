import crypto from 'node:crypto';
import {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3';
import {transferStoredLimit} from './transfer-text.js';
const key=id=>{if(!/^[a-f0-9]{24}$/.test(String(id)))throw Error('Invalid transfer ID');return `submissions/${id}.txt`;};
export function createTransferStorage(config,client=new S3Client({region:'auto',endpoint:config.endpoint,credentials:config.credentials,maxAttempts:2})) {
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(20000)});
  async function read(id,sha256) {
    const result=await send(new GetObjectCommand({Bucket:config.bucket,Key:key(id)}));
    if(result.ContentLength>transferStoredLimit){result.Body.destroy?.();throw Error('Invalid stored size');}
    const chunks=[];let size=0;
    for await(const chunk of result.Body){size+=chunk.length;if(size>transferStoredLimit){result.Body.destroy?.();throw Error('Invalid stored size');}chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Transfer integrity mismatch');
    return bytes;
  }
  return {read,async write(id,text,sha256){
    await send(new PutObjectCommand({Bucket:config.bucket,Key:key(id),Body:text,ContentType:'text/plain; charset=utf-8',CacheControl:'private, no-store',Metadata:{sha256}}));
    await read(id,sha256);
  },async remove(id){await send(new DeleteObjectCommand({Bucket:config.bucket,Key:key(id)}));}};
}
let storage;
export function getTransferStorage(){
  if(storage)return storage;
  const env=process.env;
  if(!['TRANSFER_R2_BUCKET','TRANSFER_R2_ENDPOINT','TRANSFER_R2_ACCESS_KEY_ID','TRANSFER_R2_SECRET_ACCESS_KEY'].every(k=>env[k]))throw Object.assign(Error('作品搬运暂未开放，请稍后再试'),{status:503});
  if([env.R2_BUCKET,env.COVER_R2_BUCKET].includes(env.TRANSFER_R2_BUCKET)||!/^https:\/\/[a-f0-9]{32}(?:\.(?:eu|us))?\.r2\.cloudflarestorage\.com\/?$/.test(env.TRANSFER_R2_ENDPOINT))throw Error('Invalid isolated transfer storage');
  return storage=createTransferStorage({bucket:env.TRANSFER_R2_BUCKET,endpoint:env.TRANSFER_R2_ENDPOINT,credentials:{accessKeyId:env.TRANSFER_R2_ACCESS_KEY_ID,secretAccessKey:env.TRANSFER_R2_SECRET_ACCESS_KEY}});
}
