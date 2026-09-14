import crypto from 'node:crypto';
import {PutObjectCommand, GetObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3';
import {r2Client, bodyHash} from './r2.js';
import {createChapterStorage} from './chapter-storage.js';

export function createWritingStorage({client = r2Client(), bucket = process.env.R2_BUCKET} = {}) {
  const chapters = createChapterStorage({client, bucket});
  const validKey = key => /^drafts\/[a-f0-9]{24}\/[a-f0-9-]{36}\.txt$/.test(key || '');
  return {
    key: owner => `drafts/${owner}/${crypto.randomUUID()}.txt`,
    async write(key, content) {
      if (!validKey(key)) throw Error('Invalid draft key');
      await client.send(new PutObjectCommand({Bucket: bucket, Key: key, Body: content, ContentType: 'text/plain; charset=utf-8'}));
      return bodyHash(content);
    },
    async read(draft) {
      if (!draft.contentKey) return '';
      if (!validKey(draft.contentKey)) throw Error('Invalid draft key');
      const result = await client.send(new GetObjectCommand({Bucket: bucket, Key: draft.contentKey}));
      if (result.ContentLength > 240000) throw Error('Draft too large');
      const content = await result.Body.transformToString('utf-8');
      if (content.length > 60000 || bodyHash(content) !== draft.contentSha256) throw Error('Draft checksum mismatch');
      return content;
    },
    async remove(key) {
      if (!validKey(key)) throw Error('Invalid draft key');
      await client.send(new DeleteObjectCommand({Bucket: bucket, Key: key}));
    },
    publish: content => chapters.write(content),
    readChapter: chapter => chapters.read(chapter),
  };
}
