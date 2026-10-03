/** Versioned progress outbox. No React/browser globals: storage and authenticated transport
 * are injected so the same race/offline behavior can be tested without a mock UI. */
export type ReadingAnchor={paragraphKey:string;paragraphIndex:number;charOffset:number};
export type ReadingPosition=ReadingAnchor & {chapterId:string;chapterNumber:number;contentVersion:string|null};
export type CloudProgress={revision:number;position:ReadingPosition|null;deleted?:boolean;furthest?:ReadingPosition|null};
type Operation={baseRevision:number;operationId:string;deviceId:string;position:ReadingPosition};
export type ProgressState={remote:CloudProgress|null;local:ReadingPosition|null;pending:Operation|null;conflict:'PROGRESS_CONFLICT'|'CONTENT_CHANGED'|null;ready:boolean;error:string};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const accountChangedMessage='登录账户已变化，本机队列仍保留在原账户；请刷新后继续。';
/** The header is checked against the authenticated identity by the progress endpoint.
 * A preliminary session read alone cannot close a cross-tab cookie-change race. */
export function accountBoundProgressRequest(account:string|null,request:typeof fetch,active:()=>boolean=()=>true):typeof fetch {
  return async(input,init)=>{
    const response=await request('/api/auth/session',{cache:'no-store',signal:init?.signal});
    const session=response.ok?await response.json():null;
    if(!active()||session?.user?.id!==account)throw Error(accountChangedMessage);
    const headers=new Headers(init?.headers);headers.set('X-Reading-Account',account!);
    return request(input,{...init,headers});
  };
}
export const equalPosition=(a:ReadingPosition|null,b:ReadingPosition|null)=>a?.chapterId===b?.chapterId&&a?.contentVersion===b?.contentVersion&&a?.paragraphKey===b?.paragraphKey&&a?.charOffset===b?.charOffset;
export class ReadingProgress {
  state:ProgressState={remote:null,local:null,pending:null,conflict:null,ready:false,error:''};
  readonly key:string;
  private active=true;
  private verified=false;
  private sending=false;
  private opening:Promise<void>|null=null;
  private awaitMovement=false;
  private abort=new AbortController();
  constructor(readonly account:string,readonly book:string,private storage:StorageLike,private request:typeof fetch,
    private notify:(state:ProgressState)=>void,private uuid:()=>string=()=>crypto.randomUUID()) {
    this.key=`reader-progress:v1:${encodeURIComponent(account)}:${encodeURIComponent(book)}`;
    try {const saved=JSON.parse(storage.getItem(this.key)||'null');if(saved&&saved.account===account&&saved.book===book){
      this.state={...this.state,remote:saved.remote||null,local:saved.local||null,pending:saved.pending||null,conflict:saved.conflict||null};
    }} catch { /* Corrupt/disabled storage cannot grant a server revision. */ }
  }
  private emit(){if(!this.active)return;this.state={...this.state};try{this.storage.setItem(this.key,JSON.stringify({account:this.account,book:this.book,...this.state}));}catch{this.state.error='浏览器存储不可用，请保持此页打开以同步阅读位置。';}this.notify(this.state);}
  private deviceId:string|null=null;
  private device(){if(this.deviceId)return this.deviceId;const key=`reader-progress-device:${this.account}`;try{this.deviceId=this.storage.getItem(key)||this.uuid();this.storage.setItem(key,this.deviceId);}catch{this.deviceId=this.uuid();}return this.deviceId;}
  private operation(position:ReadingPosition):Operation{return {baseRevision:this.state.remote?.revision??0,operationId:this.uuid(),deviceId:this.device(),position};}
  private url(){return `/api/v1/me/reading-progress/${encodeURIComponent(this.book)}`;}
  close(){this.active=false;this.abort.abort();}
  async open(){
    if(this.opening)return this.opening;
    this.opening=this.read().finally(()=>{this.opening=null;});return this.opening;
  }
  private async read(){
    if(!this.active)return;
    if(this.account==='guest'){this.state.ready=true;this.emit();return;}
    try {
      const response=await this.request(this.url(),{cache:'no-store',signal:this.abort.signal});
      if(!response.ok){
        const body=await response.json().catch(()=>null);
        if(body?.code==='ACCOUNT_CHANGED'){this.verified=false;throw Error(accountChangedMessage);}
        throw Error('云端阅读位置暂不可用；本机位置会保留，联网后重试。');
      }
      const remote:CloudProgress=await response.json();if(!this.active)return;
      if(!Number.isSafeInteger(remote.revision)||remote.revision<0)throw Error('阅读位置响应无效');
      if(this.state.ready&&this.state.remote&&remote.revision!==this.state.remote.revision&&!this.state.pending&&this.state.local&&!equalPosition(this.state.local,remote.position))this.state.conflict='PROGRESS_CONFLICT';
      this.verified=true;this.state.remote=remote;
      // An uncertain response must replay the exact operation ID. The server receipt can
      // acknowledge a previously committed write even though GET now has a newer revision.
      if(!this.state.pending&&!this.state.conflict)this.state.local=remote.position;
      this.state.ready=true;this.state.error='';this.emit();
      if(this.state.pending&&!this.state.conflict){
        await this.flush();
        // An idempotency receipt can be older than the GET snapshot when another
        // device wrote after our lost acknowledgement. Keep that newer cloud state.
        if(remote.revision>(this.state.remote?.revision??0)){
          this.state.remote=remote;
          if(!equalPosition(this.state.local,remote.position))this.state.conflict='PROGRESS_CONFLICT';
          this.emit();
        }
      }
    } catch(error){if(!this.active)return;this.state.ready=true;this.state.error=error instanceof Error?error.message:'阅读位置暂不可用';this.emit();}
  }
  record(position:ReadingPosition,intentional=false){
    if(!this.active||!this.state.ready)return;
    if(this.awaitMovement&&!intentional)return;
    this.awaitMovement=false;
    this.state.local=position;
    if(position.contentVersion&&this.account!=='guest'&&!this.state.conflict&&!equalPosition(position,this.state.remote?.position??null)&&!this.state.pending)
      this.state.pending=this.operation(position);
    this.emit();
  }
  contentChanged(position:ReadingPosition){this.state.local=position;this.state.conflict='CONTENT_CHANGED';this.emit();}
  async chooseLocal(position=this.state.local){
    if(!position||!this.verified)return;
    this.state.local=position;this.state.conflict=null;this.state.pending=this.operation(position);this.state.error='';this.emit();await this.flush();
  }
  chooseCloud(){this.state.local=this.state.remote?.position??null;this.awaitMovement=!this.state.local;this.state.pending=null;this.state.conflict=null;this.state.error='';this.emit();return this.state.local;}
  async flush(){
    if(!this.active||this.sending||!this.verified||this.state.conflict||!this.state.pending||this.account==='guest')return;
    this.sending=true;
    try {
      while(this.active&&this.state.pending&&!this.state.conflict){
        const operation=this.state.pending;
        const response=await this.request(this.url(),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation),signal:this.abort.signal});
        const body=await response.json();if(!this.active)return;
        if(response.status===409){
          if(body.code==='ACCOUNT_CHANGED'){this.verified=false;throw Error(accountChangedMessage);}
          if(body.current)this.state.remote=body.current;
          this.state.conflict=body.code==='CONTENT_CHANGED'?'CONTENT_CHANGED':'PROGRESS_CONFLICT';this.emit();return;
        }
        if(!response.ok)throw Error('阅读位置尚未同步，已保留本机队列。');
        this.state.remote=body;this.state.pending=null;this.state.error='';
        if(this.state.local&&!equalPosition(this.state.local,operation.position))this.state.pending=this.operation(this.state.local);
        this.emit();
      }
    }catch(error){if(this.active){this.state.error=error instanceof Error?error.message:'同步失败';this.emit();}}
    finally{this.sending=false;}
  }
}
