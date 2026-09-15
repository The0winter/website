// Stream the existing restore format through a private file. Neither the full
// database nor its JSON representation needs to fit in the backup process heap.
import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import mongoose from '../server/node_modules/mongoose/index.js';
import {PutObjectCommand, GetObjectCommand} from '../server/node_modules/@aws-sdk/client-s3/dist-cjs/index.js';
import {encode} from '../server/database/codec.js';
import {r2Client} from '../server/services/r2.js';

const format = 'test1-cloudflare-documents-v1';

export async function writeMongoArchive(client, file) {
  const db = client.db();
  const names = (await db.listCollections({type:'collection'}).toArray()).map(row => row.name).sort();
  const indexes = new Map();
  for (const name of names) indexes.set(name, await db.collection(name).indexes());
  const session = client.startSession();
  const createdAt = new Date().toISOString();
  let summary, bytes, sha256;
  try {
    await session.withTransaction(async () => {
      // A transaction retry truncates its private file and starts every hash anew.
      summary = []; bytes = 0;
      const hash = createHash('sha256');
      async function* documents() {
        yield JSON.stringify({format, source:'MongoDB', database:db.databaseName, createdAt}).slice(0,-1) + ',"collections":[';
        for (let i = 0; i < names.length; i++) {
          const name = names[i], contentHash = createHash('sha256');
          let count = 0;
          yield (i ? ',' : '') + JSON.stringify({name,indexes:indexes.get(name)}).slice(0,-1) + ',"documents":[';
          const cursor = db.collection(name).find({}, {session,sort:{_id:1},batchSize:200});
          try {
            for await (const doc of cursor) {
              const row = {id:String(doc._id), document:encode(doc), bson:mongoose.mongo.BSON.EJSON.stringify(doc,{relaxed:false})};
              contentHash.update(row.id + '\0' + row.document + '\n');
              yield (count++ ? ',' : '') + JSON.stringify(row);
            }
          } finally { await cursor.close(); }
          yield ']}';
          summary.push({name,count,sha256:contentHash.digest('hex')});
        }
        yield ']}';
      }
      const meter = new Transform({transform(chunk,encoding,callback) {bytes += chunk.length; hash.update(chunk); callback(null,chunk);}});
      await pipeline(Readable.from(documents(),{objectMode:false}),createGzip(),meter,createWriteStream(file,{flags:'w',mode:0o600}));
      sha256 = hash.digest('hex');
    }, {readConcern:{level:'snapshot'},readPreference:'primary'});
    return {format,source:'MongoDB',createdAt,collections:summary,bytes,sha256};
  } finally { await session.endSession(); }
}

export async function backupAtlas(uri, {directory,keepLocal=false,env=process.env,
  mongoFactory=url=>new mongoose.mongo.MongoClient(url,{serverSelectionTimeoutMS:10000,maxPoolSize:2}),
  storageFactory=()=>r2Client(env)} = {}) {
  if (!path.isAbsolute(directory || '')) throw new Error('Absolute backup directory required');
  if (!env.R2_BUCKET || env.R2_BUCKET === env.COVER_R2_BUCKET) throw new Error('Backups require the private chapter bucket');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const temporary = await fs.mkdtemp(path.join(directory,'.atlas-backup-'));
  await fs.chmod(temporary,0o700);
  const file = path.join(temporary,'snapshot.json.gz'), startedAt = new Date().toISOString();
  let mongo, storage;
  try {
    mongo = mongoFactory(uri); await mongo.connect();
    const summary = await writeMongoArchive(mongo,file);
    await mongo.close(); mongo = null; // Release the snapshot before network upload.
    const {sha256,bytes} = summary;
    const archive = `atlas-${startedAt.replaceAll(/[:.]/g,'-')}-${sha256.slice(0,12)}.json.gz`;
    const key = 'backups/database/' + archive;
    storage = storageFactory();
    const body = createReadStream(file);
    try {
      await storage.send(new PutObjectCommand({Bucket:env.R2_BUCKET,Key:key,Body:body,ContentLength:bytes,ContentType:'application/gzip',Metadata:{sha256,format}}),{abortSignal:AbortSignal.timeout(120000)});
    } finally {body.destroy();}
    const response = await storage.send(new GetObjectCommand({Bucket:env.R2_BUCKET,Key:key}),{abortSignal:AbortSignal.timeout(120000)});
    const readback = createHash('sha256'); let verifiedBytes = 0;
    try {for await (const chunk of response.Body) {readback.update(chunk); verifiedBytes += chunk.length;}}
    finally {response.Body?.destroy?.();}
    if (verifiedBytes !== bytes || readback.digest('hex') !== sha256) throw new Error('R2 backup readback mismatch');
    const {source,createdAt,collections} = summary;
    const manifest = {status:'success',startedAt,finishedAt:new Date().toISOString(),archive,bytes,sha256,source,createdAt,collections,offsite:'R2-verified',bucket:env.R2_BUCKET,key};
    if (keepLocal) await fs.copyFile(file,path.join(directory,archive),fs.constants.COPYFILE_EXCL);
    await fs.writeFile(path.join(directory,archive+'.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
    const latest = path.join(temporary,'latest.json');
    await fs.writeFile(latest,JSON.stringify(manifest,null,2),{mode:0o600});
    await fs.rename(latest,path.join(directory,'latest.json'));
    return manifest;
  } finally {
    try {if(mongo) await mongo.close();} finally {storage?.destroy(); await fs.rm(temporary,{recursive:true,force:true});}
  }
}
