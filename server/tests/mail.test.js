import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import sendEmail from '../utils/sendEmail.js';

test('SMTP delivery uses loopback receiver, propagates failure and refuses external test targets',async()=>{
  const messages=[];let reject=false;
  const receiver=net.createServer(socket=>{
    socket.setTimeout(5000,()=>socket.destroy());socket.write('220 isolated ESMTP\r\n');
    let pending='',body='',data=false;
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      pending+=chunk.toString();if(pending.length+body.length>65536){socket.destroy();return;}
      while(pending.includes('\r\n')){
        const end=pending.indexOf('\r\n'),line=pending.slice(0,end);pending=pending.slice(end+2);
        if(data){if(line==='.') {messages.push(body);body='';data=false;socket.write('250 accepted\r\n');}else body+=line+'\r\n';continue;}
        if(/^(EHLO|HELO) /.test(line))socket.write('250 isolated\r\n');
        else if(line==='DATA'){if(reject)socket.write('451 temporary failure\r\n');else {data=true;socket.write('354 send data\r\n');}}
        else if(line==='QUIT')socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
  const keys=['APP_ENV','MAIL_MODE','SMTP_HOST','SMTP_PORT','EXTERNAL_SERVICES'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{APP_ENV:'test',MAIL_MODE:'smtp-local',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(receiver.address().port),EXTERNAL_SERVICES:'disabled'});
  try {
    await sendEmail('recipient@example.test','123456');
    assert.equal(messages.length,1);assert.match(messages[0],/recipient@example.test/);
    assert.match(messages[0],/123456/);
    reject=true;await assert.rejects(sendEmail('recipient@example.test','654321'),/451/);
    process.env.SMTP_HOST='mail.example.test';await assert.rejects(sendEmail('recipient@example.test','123456'),/explicit isolation/);
    assert.equal(messages.length,1);
  } finally {for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];await new Promise(r=>receiver.close(r));}
});
