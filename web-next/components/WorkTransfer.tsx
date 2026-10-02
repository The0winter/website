'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Upload,FileText,ChevronLeft,ChevronRight,CheckCircle2} from 'lucide-react';
import {safeFetch} from '@/lib/request';
import {useAuth} from '@/contexts/AuthContext';
import './work-transfer.css';

type Submission={id:string;title:string;author:string;filename:string;status:string;bytes:number;chapterCount?:number;processed?:number;characters?:number;reason?:string;createdAt:string;bookId?:string;submitter?:string};
type Preview=Submission&{text:string;nextOffset:number|null;duplicates:{id:string;title:string}[]};
const labels:Record<string,string>={uploading:'上传未完成',pending:'待审核',importing:'正在收录',accepted:'已收录',rejected:'未通过',expired:'已过期'};
const fileSize=(bytes:number)=>bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(2)} MB`;
async function json(response:Response){const data=await response.json().catch(()=>({error:'服务暂不可用，请稍后重试'}));if(!response.ok)throw Error(data.error||'操作失败，请重试');return data;}
export default function WorkTransfer({onReady}:{onReady?:()=>void}){
  const {user}=useAuth();
  const [title,setTitle]=useState(''),[author,setAuthor]=useState(''),[file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [review,setReview]=useState(false),[page,setPage]=useState(1),[items,setItems]=useState<Submission[]>([]),[hasNext,setHasNext]=useState(false);
  const [loading,setLoading]=useState(true),[listError,setListError]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[reason,setReason]=useState('');
  const input=useRef<HTMLInputElement>(null),requestId=useRef(''),form=useRef<HTMLFormElement>(null),alive=useRef(true),loadEpoch=useRef(0);
  const load=useCallback(async()=>{
    const epoch=++loadEpoch.current;setLoading(true);setListError('');
    try{const data=await json(await safeFetch(`/api/transfers?page=${page}${review?'&review=true':''}`));if(alive.current&&epoch===loadEpoch.current){setItems(data.items);setHasNext(data.hasNext);}}
    catch(e){if(alive.current&&epoch===loadEpoch.current)setListError((e as Error).message);}finally{if(alive.current&&epoch===loadEpoch.current){setLoading(false);onReady?.();}}
  },[page,review,onReady]);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[load]);
  useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(busy||file||title||author){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[busy,file,title,author]);
  const changed=()=>{requestId.current='';setNotice('');setError('');};
  async function submit(event:React.FormEvent){
    event.preventDefault();if(!file||busy)return;
    setBusy(true);setError('');setNotice('正在上传，请保持页面打开…');
    requestId.current ||= Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
    try{
      const row:Submission=await json(await safeFetch('/api/transfers',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestId.current},body:JSON.stringify({title,author,filename:file.name,size:file.size})}));
      if(row.status==='uploading')await json(await safeFetch(`/api/transfers/${row.id}/file`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file}));
      else if(!['pending','importing','accepted'].includes(row.status))throw Error('此投稿已结束，请重新选择文件后提交');
      setTitle('');setAuthor('');setFile(null);requestId.current='';if(input.current)input.current.value='';
      if(form.current)form.current.dataset.dirty='false';setNotice('提交成功，审核结果会显示在“我的提交”中。');await load();
    }catch(e){setNotice('');setError((e as Error).message);}finally{setBusy(false);}
  }
  async function openPreview(row:Submission,offset=0){
    setBusy(true);setError('');
    try{setPreview(await json(await safeFetch(`/api/transfers/${row.id}/preview?offset=${offset}`)));setReason('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function decide(approve:boolean){
    if(!preview||busy)return;
    if(approve&&!confirm(`确认收录《${preview.title}》？完整导入后将在书库公开。`))return;
    setBusy(true);setError('');
    try{
      if(!approve)await json(await safeFetch(`/api/transfers/${preview.id}/reject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})}));
      else{
        let row:Submission=preview;
        do{
          row=await json(await safeFetch(`/api/transfers/${preview.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
          if(alive.current){setNotice(`正在收录：${row.processed||0} / ${row.chapterCount||0} 章`);setPreview(current=>current?{...current,...row}:null);}
        }while(row.status==='importing'&&alive.current);
      }
      setNotice(approve?'作品已完整收录。':'已退回投稿。');setPreview(null);await load();
    }catch(e){setError((e as Error).message);await load();}finally{setBusy(false);}
  }
  return <section className="work-transfer" aria-label="作品搬运">
    <div className="wt-intro"><span><Upload size={22}/></span><div><h2>让好故事被更多人读到</h2><p>填写作品信息，上传文件，审核后收录。</p></div></div>
    <form ref={form} className="wt-form writer-dirty-form" data-dirty={Boolean(file||title||author)} data-busy={busy} onSubmit={submit}>
      <fieldset disabled={busy}>
        <div className="wt-fields"><label>原作者<input required maxLength={200} value={author} onChange={e=>{setAuthor(e.target.value);changed();}} placeholder="填写作品原作者"/></label><label>书名<input required maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);changed();}} placeholder="填写完整书名"/></label></div>
        <label className="wt-file"><FileText size={28}/><strong>{file?file.name:'选择作品文件'}</strong><span>{file?`${fileSize(file.size)} · 点击重新选择`:'支持 TXT，单个文件不超过 30 MB'}</span><input ref={input} type="file" accept=".txt,text/plain" aria-label="作品文件" onChange={e=>{changed();const selected=e.target.files?.[0];if(!selected){setFile(null);return;}if(!/\.txt$/i.test(selected.name)||!selected.size||selected.size>30*1024*1024){setError('请选择 30 MB 以内的非空 TXT 文件');setFile(null);e.target.value='';return;}setFile(selected);}}/></label>
        <div className="wt-submit"><p>24 小时内最多提交 3 份，最多 5 份待审核。</p><button type="submit" disabled={!file||!title.trim()||!author.trim()||busy}><Upload size={17}/>{busy?'处理中…':'提交审核'}</button></div>
      </fieldset>
    </form>
    {error&&<p className="wt-error" role="alert">{error}</p>}
    {notice&&<p className="wt-notice" role="status"><CheckCircle2 size={17}/>{notice}</p>}
    <div className="wt-record-heading"><div role="tablist" aria-label="搬运记录"><button role="tab" aria-selected={!review} disabled={busy} onClick={()=>{setReview(false);setPage(1);setPreview(null);}}>我的提交</button>{user?.role==='admin'&&<button role="tab" aria-selected={review} disabled={busy} onClick={()=>{setReview(true);setPage(1);setPreview(null);}}>搬运审核</button>}</div><button disabled={busy||loading} onClick={()=>void load()}>刷新</button></div>
    {preview&&<section className="wt-preview" aria-label="投稿审核"><div className="wt-record-heading"><h3>{preview.title}</h3><button disabled={busy} onClick={()=>setPreview(null)}>关闭预览</button></div><p>{preview.author} · {preview.chapterCount} 章 · {preview.characters?.toLocaleString()} 字符</p>{preview.duplicates.length>0&&<p className="wt-error">已有同名同作者作品，暂不能直接收录。</p>}<pre>{preview.text}</pre><div className="wt-preview-actions"><button disabled={busy} onClick={()=>void openPreview(preview)}>从头查看</button><button disabled={busy||preview.nextOffset===null} onClick={()=>void openPreview(preview,preview.nextOffset!)}>下一段</button></div><label>未通过原因<input maxLength={500} value={reason} disabled={busy||preview.status==='importing'} onChange={e=>setReason(e.target.value)} placeholder="填写需要补充或修改的内容"/></label><div className="wt-preview-actions"><button disabled={busy||!reason.trim()||preview.status==='importing'} onClick={()=>void decide(false)}>退回投稿</button><button className="wt-primary" disabled={busy||preview.duplicates.length>0} onClick={()=>void decide(true)}>{preview.status==='importing'?'继续收录':'审核通过并收录'}</button></div></section>}
    {loading?<p className="wt-empty" role="status">正在读取提交记录…</p>:listError?<p className="wt-error" role="alert">{listError}</p>:items.length?<div className="wt-records">{items.map(row=><article key={row.id}><div><h3>{row.title}</h3><p>{row.author}{review&&` · 投稿人：${row.submitter}`}</p><small>{new Date(row.createdAt).toLocaleDateString('zh-CN')} · {fileSize(row.bytes)}</small>{row.reason&&<p>{row.reason}</p>}</div><div className="wt-record-action"><span data-status={row.status}>{labels[row.status]}</span>{review&&<button disabled={busy} onClick={()=>void openPreview(row)}>查看投稿</button>}{row.status==='accepted'&&<a href={`/book/${row.bookId}`}>查看作品</a>}</div></article>)}</div>:<p className="wt-empty">{review?'暂无待审核投稿':'还没有提交记录'}</p>}
    {(page>1||hasNext)&&<nav className="wt-pagination" aria-label="投稿分页"><button disabled={busy||loading||page===1} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={16}/>上一页</button><span>{page}</span><button disabled={busy||loading||!hasNext} onClick={()=>setPage(n=>n+1)}>下一页<ChevronRight size={16}/></button></nav>}
  </section>;
}
