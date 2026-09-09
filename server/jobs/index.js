import mongoose from 'mongoose';
import {readConfig} from '../config.js';
import {updateStatistics} from './statistics.js';
const config=readConfig();
if(process.env.RUN_JOBS!=='enabled')throw new Error('RUN_JOBS must be explicitly enabled in the one job process');
mongoose.set('bufferCommands',false);
await mongoose.connect(config.uri,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,socketTimeoutMS:10000,maxPoolSize:5});
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){try{console.log(JSON.stringify(await updateStatistics(new Date(),()=>stopping)));}catch(e){if(e.name!=='AbortError')console.error('Statistics job failed',e.name);}for(let i=0;i<60&&!stopping;i++)await new Promise(r=>setTimeout(r,1000));}
await mongoose.disconnect();
