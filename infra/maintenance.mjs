import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function createMaintenance(){
  return http.createServer((request,response)=>{
    response.writeHead(503,{'Content-Type':request.url?.startsWith('/api/')?'application/json; charset=utf-8':'text/html; charset=utf-8','Retry-After':'60','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
    response.end(request.url?.startsWith('/api/')?JSON.stringify({error:'网站维护中，请稍后重试'}):'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>网站维护中</title><h1>网站维护中</h1><p>暂时无法提供服务，请稍后重试。</p></html>');
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const port=Number(process.env.PORT||5004);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid maintenance port');
  const server=createMaintenance().listen(port,'127.0.0.1');
  process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
}
