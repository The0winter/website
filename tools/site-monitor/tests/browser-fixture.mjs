import '../../test-env.cjs';
import {createMonitor} from '../server.mjs';
import {fixtureCollectors,workspace,removeWorkspace} from './fixture.mjs';
const root=workspace();
const app=await createMonitor({root,collect:fixtureCollectors(),start:false,remote:async()=>({bytes:1234567,objects:20,pages:1,complete:true,cursor:null,groups:{chapters:{bytes:1234567,objects:20}}})});
await app.session.refresh();await app.session.refresh('server');
console.log(JSON.stringify({url:app.url}));
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();removeWorkspace(root);process.stdin.destroy();}
process.stdin.on('data',()=>void close());process.stdin.on('end',()=>void close());process.on('SIGTERM',close);process.on('SIGINT',close);
