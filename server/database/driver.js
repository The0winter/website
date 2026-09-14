import mongoose from 'mongoose';
import BaseConnection from 'mongoose/lib/connection.js';
import BaseCollection from 'mongoose/lib/collection.js';
import {find as query, aggregate, updateOne as modify} from 'mingo';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {clone, decode, encode, identifier, literal, normalize} from './codec.js';
import {fieldSql,filterPlan,projectionSql} from './query.js';
import {baseSchema, collectionSchema, indexSchema} from './schema.js';
import {D1Transport, LocalSqlTransport} from './transport.js';

const engineOptions = {scriptEnabled:false};
const duplicate = () => Object.assign(new Error('Duplicate database key'),{code:11000});
const translate = error => {
  if (/D1_WRITE_CONFLICT/.test(error.message)) error.code = 'D1_WRITE_CONFLICT';
  if (/UNIQUE constraint/.test(error.message)) error.code = 11000;
  return error;
};
function setPath(object, field, value) {
  const parts=field.split('.');let target=object;
  for(const part of parts.slice(0,-1)) {if(['__proto__','prototype','constructor'].includes(part)) throw new Error('Unsafe document path');target=target[part] ||= {};}
  if(['__proto__','prototype','constructor'].includes(parts.at(-1))) throw new Error('Unsafe document path');
  target[parts.at(-1)]=value;
}
function upsertSeed(filter) {
  const seed={};
  for(const [key,value] of Object.entries(normalize(filter))) {
    if(key === '$and') {for(const item of value) Object.assign(seed,upsertSeed(item));}
    else if(!key.startsWith('$') && !(value instanceof RegExp) && (!value || typeof value!=='object' || value instanceof Date)) setPath(seed,key,value);
    else if(!key.startsWith('$') && value && Object.keys(value).length===1 && Object.hasOwn(value,'$eq')) setPath(seed,key,value.$eq);
  }
  return seed;
}
function cursor(load, options = {}) {
  let rows, offset=0, closed=false;
  const ready=async()=>rows ||= await load(options);
  return {sort(value){options.sort=value;return this;},limit(value){options.limit=value;return this;},skip(value){options.skip=value;return this;},project(value){options.projection=value;return this;},maxTimeMS(){return this;},batchSize(){return this;},
    async toArray(){return closed?[]:clone(await ready());},async next(){return closed?null:clone((await ready())[offset++] ?? null);},async close(){closed=true;rows=[];},
    async *[Symbol.asyncIterator](){while(!closed){const row=await this.next();if(row===null)return;yield row;}}};
}

class SqlSession {
  constructor(connection) {this.connection=connection;this.active=false;this.dirty=new Map();this.created=new Set();this.prefetched=new Map();}
  inTransaction(){return this.active;}
  async endSession(){this.active=false;this.dirty.clear();this.created.clear();this.prefetched.clear();}
  async withTransaction(fn) {return this.connection.runTransaction(fn,this);}
  changes(name){let rows=this.dirty.get(name);if(!rows)this.dirty.set(name,rows=new Map());return rows;}
  async prefetch(name,filter) {
    const rows=await this.connection.collection(name).rows(filter,{session:this});
    this.prefetched.set(name,{filter:normalize(filter),rows});
  }
}

export class SqlConnection extends BaseConnection {
  async createClient(uri, options = {}) {
    this.readyState=2;this._connectionString=uri;this.config={...this.config,autoIndex:false,autoCreate:false,bufferCommands:false};
    this.options=options;this.schemas=new Map();
    if(uri.startsWith('sqlite:')) {
      const filename=uri==='sqlite::memory:'?':memory:':fileURLToPath(uri.replace(/^sqlite:/,'file:'));
      this.transport=await LocalSqlTransport.open(filename);this.name='test1_test';
    } else if(uri.startsWith('d1:')) {
      const target=new URL(uri);this.name=target.pathname.slice(1);
      this.transport=new D1Transport({accountId:target.hostname,databaseId:this.name,token:process.env.CLOUDFLARE_D1_API_TOKEN});
    } else throw new Error('SQL driver requires an explicit sqlite: or d1: URL');
    await this.transport.batch(baseSchema);
    this.db={collection:name=>this.collection(name),createCollection:async name=>{await this.ensureCollection(name);return this.collection(name);},
      databaseName:this.name,
      listCollections:()=>cursor(async()=>(await this.transport.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_d1_%' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")).map(row=>({...row,type:'collection'}))),
      command:async command=>{if(command.ping){await this.transport.query('SELECT 1 AS ok');return {ok:1};}throw new Error('Unsupported database command');}};
    this.client={startSession:()=>new SqlSession(this)};
    for(const name of Object.keys(this.collections)) await this.ensureCollection(name);
    this.onOpen();return this;
  }
  async ensureCollection(name) {
    if(!this.transport) throw new Error('Database not connected');
    if(!this.schemas.has(name)) this.schemas.set(name,this.transport.batch(collectionSchema(name)));
    await this.schemas.get(name);
  }
  async doClose(){if(this.transport)await this.transport.close();this.schemas?.clear();}
  async startSession(){return new SqlSession(this);}
  async runTransaction(fn, suppliedSession) {
    for(let attempt=0;attempt<12;attempt++) {
      const session=suppliedSession || new SqlSession(this);
      session.dirty.clear();session.created.clear();session.prefetched.clear();session.active=true;
      session.revision=(await this.transport.query('SELECT revision FROM _d1_meta WHERE id=1'))[0].revision;
      try {
        const value=await fn(session);
        const guard=randomUUID();const statements=[`INSERT INTO _d1_guard VALUES(${literal(guard)},${session.revision})`];
        for(const [name,rows] of session.dirty) for(const [id,doc] of rows) {
          let valueSql=doc===null?null:literal(encode(doc)), staged;
          if(valueSql && Buffer.byteLength(valueSql)>80000) {
            // D1 allows 2 MB rows but only 100 KB SQL statements. Large legacy
            // drafts use a bound staging value, consumed by the atomic commit.
            const document=encode(doc);
            if(Buffer.byteLength(document)>1900000)throw new Error('Database document exceeds D1 row limit');
            staged=randomUUID();await this.transport.stageValue(staged,document);
            valueSql=`(SELECT document FROM _d1_values WHERE id=${literal(staged)})`;
          }
          statements.push(doc===null ? `DELETE FROM ${identifier(name)} WHERE id=${literal(id)}` :
            `INSERT INTO ${identifier(name)}(id,document) VALUES(${literal(id)},${valueSql})${session.created.has(name+'\0'+id)?'':' ON CONFLICT(id) DO UPDATE SET document=excluded.document,revision=revision+1'}`);
          if(staged)statements.push(`DELETE FROM _d1_values WHERE id=${literal(staged)}`);
        }
        statements.push(`DELETE FROM _d1_guard WHERE id=${literal(guard)}`);
        await this.transport.batch(statements,{recordCommit:session.dirty.size>0});
        session.active=false;return value;
      } catch(error) {
        session.active=false;translate(error);
        if(error.code!=='D1_WRITE_CONFLICT' || attempt===11) throw error;
        await new Promise(resolve=>setTimeout(resolve,Math.min(5*(attempt+1),40)));
      }
    }
  }
  async transaction(fn){return this.runTransaction(fn);}
}

export class SqlCollection extends BaseCollection {
  scalarFields() {
    const fields=new Set(['_id']);
    const model=Object.values(this.conn.models).find(model=>model.collection.name===this.name);
    model?.schema.eachPath((name,type)=>{if(['String','Number','Boolean','Date','ObjectId'].includes(type.instance))fields.add(name);});
    return fields;
  }
  async rows(filter = {}, options = {}) {
    await this.conn.ensureCollection(this.name);
    const scalarFields=this.scalarFields(),plan=filterPlan(filter,scalarFields);
    const pending=options.session?.active && options.session.dirty.get(this.name);
    const prefetched=options.session?.active && options.session.prefetched.get(this.name), normalizedFilter=normalize(filter);
    const cached=prefetched && (Object.entries(prefetched.filter).every(([key,value])=>encode(normalizedFilter[key])===encode(value)) || (typeof normalizedFilter._id==='string' && prefetched.rows.some(row=>row._id===normalizedFilter._id)));
    const projection=projectionSql(options.projection);
    const exact=!cached && plan.exact && !pending?.size && projection!==null && Object.keys(options.sort||{}).every(key=>scalarFields.has(key));
    const sort=exact&&options.sort ? ' ORDER BY '+Object.entries(options.sort).map(([key,value])=>`${fieldSql(key)} ${value===-1?'DESC':'ASC'}`).join(',') : '';
    const limit=exact&&(options.limit||options.skip) ? ` LIMIT ${options.limit?Math.abs(Number(options.limit)):-1}${options.skip?' OFFSET '+Number(options.skip):''}` : '';
    const sql=`SELECT ${exact?projection:'document'} AS document FROM ${identifier(this.name)} WHERE ${plan.sql}${sort}${limit}`;
    const candidates=cached?prefetched.rows:(await this.conn.transport.query(sql)).map(row=>decode(row.document));
    if(exact)return candidates;
    const rows=new Map(candidates.map(doc=>[String(doc._id),doc]));
    if(pending)for(const [id,doc] of pending){if(doc===null)rows.delete(id);else rows.set(id,clone(doc));}
    let result=query([...rows.values()],normalize(filter),null,engineOptions);
    if(options.sort) result=result.sort(options.sort);
    if(options.skip) result=result.skip(options.skip);
    if(options.limit) result=result.limit(Math.abs(options.limit));
    const documents=cached?clone(result.all()):result.all();
    return options.projection ? query(documents,{},normalize(options.projection),engineOptions).all() : documents;
  }
  find(filter,options={}){return cursor(opts=>this.rows(filter,opts),{...options});}
  async findOne(filter,options={}){return (await this.rows(filter,{...options,limit:1}))[0] || null;}
  async countDocuments(filter,options={}){
    await this.conn.ensureCollection(this.name);const plan=filterPlan(filter,this.scalarFields());
    if(plan.exact&&!options.session?.dirty.get(this.name)?.size)return (await this.conn.transport.query(`SELECT COUNT(*) AS n FROM ${identifier(this.name)} WHERE ${plan.sql}`))[0].n;
    return (await this.rows(filter,options)).length;
  }
  async estimatedDocumentCount(){await this.conn.ensureCollection(this.name);return (await this.conn.transport.query(`SELECT COUNT(*) AS n FROM ${identifier(this.name)}`))[0].n;}
  async distinct(field,filter={},options={}) {return [...new Set((await this.rows(filter,options)).flatMap(doc=>field.split('.').reduce((v,k)=>v?.[k],doc) ?? []))];}
  async mutate(options,fn) {
    if(options?.session?.active) return fn(options.session);
    return this.conn.runTransaction(fn);
  }
  async insertOne(input,options={}) {
    return this.mutate(options,async session=>{
      const doc=clone(input);doc._id ??= new mongoose.Types.ObjectId().toString();
      const pending=session.changes(this.name).get(String(doc._id));
      if(pending)throw duplicate();
      if(pending!==null)session.created.add(this.name+'\0'+doc._id);
      session.changes(this.name).set(String(doc._id),doc);
      return {acknowledged:true,insertedId:doc._id};
    });
  }
  async insertMany(documents,options={}) {
    return this.mutate(options,async session=>{
      const insertedIds={};for(let i=0;i<documents.length;i++)insertedIds[i]=(await this.insertOne(documents[i],{...options,session})).insertedId;
      return {acknowledged:true,insertedCount:documents.length,insertedIds};
    });
  }
  async update(filter,modifier,options={},many=false) {
    return this.mutate(options,async session=>{
      let documents=await this.rows(filter,{session,sort:options.sort,...(!many?{limit:1}:{})});
      const inserted=!documents.length && !!options.upsert;
      if(inserted){const doc=upsertSeed(filter);doc._id ??= new mongoose.Types.ObjectId().toString();documents=[doc];}
      let modifiedCount=0;const before=documents[0]?clone(documents[0]):null;let after=null;
      for(const initial of documents) {
        const rows=[clone(initial)];let update=normalize(modifier);
        const replacement=!Array.isArray(update) && !Object.keys(update).some(key=>key.startsWith('$'));
        if(!Array.isArray(update)) {
          update={...update};const onInsert=update.$setOnInsert;delete update.$setOnInsert;
          if(inserted && onInsert) update.$set={...onInsert,...update.$set};
        }
        if(replacement) rows[0]={...clone(update),_id:initial._id};
        else if(Array.isArray(update) || Object.keys(update).length) modify(rows,{},update,{arrayFilters:options.arrayFilters,cloneMode:'deep'},engineOptions);
        const doc=rows[0];
        if(String(doc._id)!==String(initial._id)) throw new Error('Document ID is immutable');
        if(inserted) {
          const pending=session.changes(this.name).get(String(doc._id));
          if(pending)throw duplicate();
          if(pending!==null)session.created.add(this.name+'\0'+doc._id);
        }
        const changed=inserted || encode(doc)!==encode(initial);
        if(changed){session.changes(this.name).set(String(doc._id),doc);if(!inserted)modifiedCount++;}
        after=clone(doc);
      }
      return {acknowledged:true,matchedCount:inserted?0:documents.length,modifiedCount,upsertedCount:inserted?1:0,upsertedId:inserted?documents[0]._id:null,before:inserted?null:before,after};
    });
  }
  async updateOne(filter,modifier,options={}){const {before,after,...result}=await this.update(filter,modifier,options);return result;}
  async updateMany(filter,modifier,options={}){const {before,after,...result}=await this.update(filter,modifier,options,true);return result;}
  async replaceOne(filter,document,options={}){return this.updateOne(filter,document,options);}
  async findOneAndUpdate(filter,modifier,options={}) {
    const result=await this.update(filter,modifier,options);
    let value=options.returnDocument==='after'||options.new?result.after:result.before;
    if(value && options.projection)value=query([value],{},options.projection,engineOptions).all()[0];
    return options.includeResultMetadata ? {value,ok:1,lastErrorObject:{n:value?1:0,updatedExisting:!result.upsertedCount,...(result.upsertedCount?{upserted:result.upsertedId}:{})}} : value;
  }
  async remove(filter,options={},many=false) {
    return this.mutate(options,async session=>{
      const rows=await this.rows(filter,{session,...(!many?{limit:1}:{}),sort:options.sort});
      for(const row of rows)session.changes(this.name).set(String(row._id),null);
      return {acknowledged:true,deletedCount:rows.length,value:rows[0]||null};
    });
  }
  async deleteOne(filter,options={}){const {value,...result}=await this.remove(filter,options);return result;}
  async deleteMany(filter,options={}){const {value,...result}=await this.remove(filter,options,true);return result;}
  async findOneAndDelete(filter,options={}){const {value}=await this.remove(filter,options);return options.includeResultMetadata?{value,ok:1}:value;}
  aggregate(pipeline,options={}) {
    return cursor(async()=>{
      const normalized=normalize(pipeline);
      // Common catalog statistics stay inside D1; do not transfer every chapter
      // document just to sum words or count chapters by book.
      const groupAt=normalized[0]?.$match?1:0, group=normalized[groupAt]?.$group;
      if(group && !options.session?.dirty.get(this.name)?.size) {
        await this.conn.ensureCollection(this.name);
        const plan=filterPlan(normalized[0]?.$match||{},this.scalarFields());
        const expression=value=>typeof value==='string'&&value.startsWith('$')&&this.scalarFields().has(value.slice(1))?fieldSql(value.slice(1)):null;
        const groupKey=group._id===null?'NULL':expression(group._id),fields=[];
        let supported=plan.exact && groupKey!==null;
        for(const [name,value] of Object.entries(group)) {
          if(name==='_id')continue;
          const entries=Object.entries(value||{}),[operator,operand]=entries[0]||[];
          if(entries.length!==1 || !['$sum','$max','$min','$avg'].includes(operator)){supported=false;break;}
          const sqlOperand=typeof operand==='number'?literal(operand):expression(operand);
          if(sqlOperand===null){supported=false;break;}
          fields.push(`${operator.slice(1).toUpperCase()}(${sqlOperand}) AS ${identifier(name)}`);
        }
        if(supported && fields.length) {
          const result=await this.conn.transport.query(`SELECT ${groupKey} AS _id,${fields.join(',')} FROM ${identifier(this.name)} WHERE ${plan.sql}${group._id===null?' HAVING COUNT(*)>0':' GROUP BY '+groupKey}`);
          return aggregate(result,normalized.slice(groupAt+1),engineOptions);
        }
      }
      const names=new Set();
      function visit(stages){for(const stage of stages){if(stage.$lookup){
        const lookup=stage.$lookup;names.add(lookup.from);
        if(lookup.pipeline && lookup.localField && lookup.foreignField) {
          if(Object.hasOwn(lookup.let||{},'d1_join_value'))throw new Error('Reserved aggregation variable');
          lookup.let={...lookup.let,d1_join_value:'$'+lookup.localField};
          lookup.pipeline=[{$match:{$expr:{$eq:['$'+lookup.foreignField,'$$d1_join_value']}}},...lookup.pipeline];
          delete lookup.localField;delete lookup.foreignField;
        }
        visit(lookup.pipeline||[]);
      }if(stage.$unionWith){names.add(typeof stage.$unionWith==='string'?stage.$unionWith:stage.$unionWith.coll);visit(stage.$unionWith.pipeline||[]);}}}
      visit(normalized);
      const joined=new Map();for(const name of names)joined.set(name,await this.conn.collection(name).rows({},options));
      const rows=await this.rows(normalized[0]?.$match || {},options);
      const aggregateOptions={...engineOptions,collectionResolver:name=>{if(!joined.has(name))throw new Error('Unknown join collection');return joined.get(name);}};
      // Mingo implements windows using an internal $function. Keep scripting
      // disabled and evaluate the application's whole-result windows explicitly.
      let result=rows, pending=[];
      for(const stage of normalized) {
        if(!stage.$setWindowFields){pending.push(stage);continue;}
        result=aggregate(result,pending,aggregateOptions);pending=[];
        const window=stage.$setWindowFields;
        if(window.partitionBy || window.sortBy)throw new Error('Unsupported partitioned SQL document window');
        const group={_id:null};
        for(const [name,expression] of Object.entries(window.output)) {
          if(JSON.stringify(expression.window?.documents)!=='["unbounded","unbounded"]')throw new Error('Unsupported bounded SQL document window');
          const entries=Object.entries(expression).filter(([key])=>key!=='window');
          if(entries.length!==1 || !['$max','$min','$sum','$avg'].includes(entries[0][0]))throw new Error('Unsupported SQL document window accumulator');
          group[name]=Object.fromEntries(entries);
        }
        const [{_id,...values}={}]=aggregate(result,[{$group:group}],aggregateOptions);
        result=result.map(row=>({...row,...values}));
      }
      return aggregate(result,pending,aggregateOptions);
    });
  }
  async createIndex(keys,options={}){await this.conn.ensureCollection(this.name);const index=indexSchema(this.name,keys,options);await this.conn.transport.batch(index.statements);return index.name;}
  async createIndexes(indexes){const names=[];for(const index of indexes){const {key,...options}=index;names.push(await this.createIndex(key,options));}return names;}
  listIndexes(){return cursor(async()=>[{name:'_id_',key:{_id:1},unique:true},...(await this.conn.transport.query(`SELECT definition FROM _d1_indexes WHERE collection_name=${literal(this.name)}`)).map(row=>decode(row.definition))]);}
  async indexes(){return this.listIndexes().toArray();}
  async dropIndex(name){const index=(await this.indexes()).find(row=>row.name===name);if(!index?.sqlName)throw new Error('Index not found');await this.conn.transport.batch([`DROP INDEX ${identifier(index.sqlName)}`,`DELETE FROM _d1_indexes WHERE collection_name=${literal(this.name)} AND index_name=${literal(name)}`]);}
  async bulkWrite(operations,options={}) {
    return this.mutate(options,async session=>{
      const result={acknowledged:true,insertedCount:0,matchedCount:0,modifiedCount:0,deletedCount:0,upsertedCount:0,upsertedIds:{}};
      for(let i=0;i<operations.length;i++){
        const [method,args]=Object.entries(operations[i])[0];const opts={...options,...args,session};let out;
        if(method==='insertOne'){out=await this.insertOne(args.document,opts);result.insertedCount++;}
        else if(['updateOne','updateMany','replaceOne'].includes(method))out=await this[method](args.filter,args.update||args.replacement,opts);
        else if(['deleteOne','deleteMany'].includes(method))out=await this[method](args.filter,opts);
        else throw new Error('Unsupported bulk operation');
        for(const key of ['matchedCount','modifiedCount','deletedCount','upsertedCount'])result[key]+=out[key]||0;
        if(out.upsertedId)result.upsertedIds[i]=out.upsertedId;
      }
      return result;
    });
  }
}

const sqlDriver={Connection:SqlConnection,Collection:SqlCollection};
export function installSqlDriver(){if(mongoose.__driver!==sqlDriver)mongoose.setDriver(sqlDriver);return mongoose;}
