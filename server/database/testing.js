import '../../tools/test-env.cjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import mongoose from 'mongoose';
import {installSqlDriver} from './driver.js';

export class TestDatabase {
  static async create() {
    installSqlDriver();
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'test1-sqlite-'));
    return new TestDatabase(directory);
  }
  constructor(directory) {this.directory=fs.realpathSync(directory);this.filename=path.join(this.directory,'test.sqlite');}
  getUri() {return pathToFileURL(this.filename).href.replace(/^file:/,'sqlite:');}
  async stop({doCleanup=true}={}) {
    if(mongoose.connection._connectionString===this.getUri() && mongoose.connection.readyState)await mongoose.disconnect();
    if(!doCleanup)return;
    // Remove only this fixture's known SQLite files; unexpected files are retained.
    for(const suffix of ['', '-wal', '-shm', '-journal'])fs.rmSync(this.filename+suffix,{force:true});
    if(fs.existsSync(this.directory))fs.rmdirSync(this.directory);
  }
}
