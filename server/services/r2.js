import {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3';
import {createHash, randomUUID} from 'node:crypto';

export const bodyHash = body => createHash('sha256').update(body, 'utf8').digest('hex');
export function r2Client(env = process.env) {
  for (const key of ['R2_BUCKET','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const endpoint = new URL(env.R2_ENDPOINT);
  if (endpoint.protocol !== 'https:' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) || endpoint.pathname !== '/') throw new Error('Invalid R2 endpoint');
  return new S3Client({region:'auto',endpoint:endpoint.origin,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:3});
}

// Probe only its own unique object; never touches chapter objects.
export async function probeR2(env = process.env) {
  const client = r2Client(env), Bucket = env.R2_BUCKET;
  const Key = `_connection-check/${randomUUID()}.txt`, Body = `R2 connection check ${randomUUID()}`;
  let uploaded = false;
  try {
    await client.send(new PutObjectCommand({Bucket,Key,Body,ContentType:'text/plain; charset=utf-8'}));
    uploaded = true;
    const result = await client.send(new GetObjectCommand({Bucket,Key}));
    if (await result.Body.transformToString() !== Body) throw new Error('R2 readback mismatch');
    return {bucket:Bucket,write:true,read:true,verified:true};
  } finally {
    if (uploaded) await client.send(new DeleteObjectCommand({Bucket,Key}));
    client.destroy();
  }
}
