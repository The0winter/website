import crypto from 'node:crypto';
import sharp from 'sharp';
import {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3';

export const coverCacheControl = 'public, max-age=31536000, immutable';
export const coverUploadLimit = 8 * 1024 * 1024;
export function coverConfig(env = process.env) {
  if (env.COVER_STORAGE !== 'r2') return null;
  for (const name of ['COVER_R2_BUCKET','COVER_R2_ENDPOINT','COVER_R2_ACCESS_KEY_ID','COVER_R2_SECRET_ACCESS_KEY','COVER_PUBLIC_BASE_URL']) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  const endpoint = new URL(env.COVER_R2_ENDPOINT), base = new URL(env.COVER_PUBLIC_BASE_URL);
  if (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password || endpoint.port || endpoint.hash) throw Error('Invalid cover R2 endpoint');
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.port) throw Error('Invalid cover public base URL');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.COVER_R2_BUCKET) || env.COVER_R2_BUCKET === env.R2_BUCKET) throw Error('Cover bucket must be separate from chapter storage');
  return {bucket:env.COVER_R2_BUCKET,baseUrl:base.origin,endpoint:endpoint.origin,credentials:{accessKeyId:env.COVER_R2_ACCESS_KEY_ID,secretAccessKey:env.COVER_R2_SECRET_ACCESS_KEY}};
}
export async function prepareCover(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > coverUploadLimit) throw Error('Invalid cover size');
  const source = sharp(bytes,{limitInputPixels:16000000,failOn:'error'}).timeout({seconds:5});
  const metadata = await source.metadata();
  if (!['jpeg','png','webp'].includes(metadata.format) || (metadata.pages || 1) > 1 || !metadata.width || !metadata.height || Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > 4) throw Error('Invalid cover image');
  const variants = [];
  for (const width of [240,480]) {
    const {data,info} = await source.clone().rotate().resize({width}).webp({quality:82,effort:4}).toBuffer({resolveWithObject:true});
    variants.push({width:info.width,height:info.height,bytes:data,sha256:crypto.createHash('sha256').update(data).digest('hex')});
  }
  return variants;
}
export function createCoverStorage(config, client = new S3Client({region:'auto',endpoint:config.endpoint,credentials:config.credentials,maxAttempts:2})) {
  return {
    async write(id, variants) {
      if (!/^[a-f0-9]{24}$/.test(id) || variants.length !== 2 || variants[0].width !== 240 || variants[1].width !== 480) throw Error('Invalid cover variants');
      const uploaded = [];
      try {
        for (const variant of variants) {
          const key = `covers/${id}/${variant.width}.webp`;
          uploaded.push(key);
          await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:variant.bytes,ContentType:'image/webp',CacheControl:coverCacheControl,Metadata:{sha256:variant.sha256}}),{abortSignal:AbortSignal.timeout(12000)});
          const result = await client.send(new GetObjectCommand({Bucket:config.bucket,Key:key}),{abortSignal:AbortSignal.timeout(12000)});
          const body = await result.Body.transformToByteArray();
          if (crypto.createHash('sha256').update(body).digest('hex') !== variant.sha256) throw Error('Cover readback mismatch');
        }
        return {storage:'r2',bucket:config.bucket,publicUrl:`${config.baseUrl}/covers/${id}/480.webp`,mime:'image/webp',sha256:variants[1].sha256,variants:variants.map(v=>({key:`covers/${id}/${v.width}.webp`,width:v.width,height:v.height,size:v.bytes.length}))};
      } catch (error) {
        // Keys belong to this never-reused media ID; cleanup cannot affect existing covers.
        await Promise.allSettled(uploaded.map(Key=>client.send(new DeleteObjectCommand({Bucket:config.bucket,Key}),{abortSignal:AbortSignal.timeout(5000)})));
        throw error;
      }
    }
  };
}
let configuredStorage;
export function getCoverStorage() {
  if (!configuredStorage) {
    const config = coverConfig();
    if (config) configuredStorage = createCoverStorage(config);
  }
  return configuredStorage;
}
