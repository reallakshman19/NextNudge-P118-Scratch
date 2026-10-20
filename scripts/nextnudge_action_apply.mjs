import {assertScratchRun,assertScratchApi} from './nextnudge_scratch_guard.mjs';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {ownerIssue} from './nextnudge_thread_apply.mjs';
import {parse,serialize,assertPublic} from '../site/nextnudge/revamp/thread.mjs';
import {applyDelta,ROOT,REPO,safeId} from '../site/nextnudge/revamp/save.mjs';
import {sendNudge,fetchReturn,targetOf,sentTarget} from '../site/nextnudge/revamp/transport.mjs';
import {checkManagedSend,loadRemoteProjects} from './nextnudge_project_guard.mjs';
const SHA=/^[a-f0-9]{40}$/;
export function unpackAction(body){
  if(typeof body!=='string'||body.length>100000)throw Error('Invalid action body');
  const pattern=new RegExp(String.fromCharCode(96).repeat(3)+'nextnudge-thread-action\\n([A-Za-z0-9+/=\\r\\n]+)\\n'+String.fromCharCode(96).repeat(3),'g');
  const matches=[...body.matchAll(pattern)];
  if(matches.length!==1)throw Error('Expected one action packet');
  const data=matches[0][1].replace(/\s/g,'');
  if(data.length>90000||data.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
    throw Error('Invalid action encoding');
  const request=JSON.parse(gunzipSync(Buffer.from(data,'base64'),{maxOutputLength:200000}).toString('utf8'));
  if(request.v!==1||!['send','fetch'].includes(request.operation)||request.delta?.v!==3||
     request.delta.baseSha!==null&&!SHA.test(request.delta.baseSha))throw Error('Invalid action request');
  safeId(request.delta.id);
  if(!Number.isSafeInteger(request.delta.expectedCount)||request.delta.expectedCount<0||
    !Array.isArray(request.delta.moves)||request.delta.moves.length>50)throw Error('Invalid thread delta');
  targetOf(request.target);assertPublic(request);return request;
}
export async function applyAction({issue,owner,read,write,listComments,postComment,comment,close,projects={}}){
  if(!ownerIssue(issue,owner))return 'IGNORED';
  let result='REJECTED',message,delivered='';
  try{
    const request=unpackAction(issue.body),file=await read(ROOT+request.delta.id+'.md');
    if((file?.sha||null)!==request.delta.baseSha)throw Error('NEEDS RELOAD: thread changed; no action executed');
    const thread=parse(applyDelta(file?parse(file.content):null,request.delta));
    const api={listComments,postComment};
    let move;
    if(request.operation==='send'){
      checkManagedSend(thread,request.target.agent,projects);
      if(request.move?.agent && request.move.agent.trim().toLowerCase()!==request.target.agent.trim().toLowerCase())
        throw Error('Target agent and recorded sent agent differ');
      move=await sendNudge(thread,request.move,request.target,api);delivered=move.evidence;
    }else{
      const sent=thread.moves.find(m=>m.id===request.moveId&&m.delivery==='sent');
      if(JSON.stringify(targetOf(sentTarget(sent).target))!==JSON.stringify(targetOf(request.target)))
        throw Error('Return target differs from the sent receipt');
      move=await fetchReturn(thread,request.moveId,api);
      if(!move){result='WAITING';message='WAITING: no new matching named-agent return. Nothing appended.';}
    }
    if(move){
      thread.moves.push(move);
      const content=serialize(thread);parse(content);
      await write(ROOT+thread.id+'.md',content,file?.sha||null);
      result='SAVED';message='SAVED: '+request.operation+' '+move.id+' · '+move.evidence;
    }
  }catch(e){
    result=delivered?'DELIVERED_NOT_RECORDED':'REJECTED';
    message=delivered?'DELIVERED_NOT_RECORDED: '+delivered+' · Retry the same packet ID to recover its receipt.':
      'REJECTED: '+String(e.message||e).slice(0,220)+' · Thread not changed; check delivery before retrying the same packet ID.';
  }
  await comment(message);await close();return result;
}
async function api(path,options={}){
  const r=await fetch(assertScratchApi(REPO,path,options),{
    ...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN,
      'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}});
  if(r.status===404)return null;
  const body=await r.json();if(!r.ok)throw Error('GitHub API '+r.status);return body;
}
async function targetIssue(target,open=false){
  targetOf(target);
  const issue=await api('issues/'+target.issue);
  if(!issue||issue.pull_request||open&&issue.state!=='open')throw Error('Target must be a project issue, open for new sends');
}
async function comments(target){
  await targetIssue(target);
  const all=[];
  for(let page=1;;page++){
    const rows=await api('issues/'+target.issue+'/comments?per_page=100&page='+page);
    if(!Array.isArray(rows))throw Error('Invalid comment listing');
    all.push(...rows);if(rows.length<100)break;
  }
  return all;
}
export async function main(){
  if(!process.env.GH_TOKEN||process.env.GITHUB_REPOSITORY!==REPO)throw Error('Wrong GitHub workflow repository or missing token');
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),number=event.issue?.number;
  assertScratchRun(process.env.GITHUB_REPOSITORY,event.repository?.full_name);
  if(!Number.isSafeInteger(number))throw Error('Missing Owner request issue');
  const issue=await api('issues/'+number);
  const projects=await loadRemoteProjects(api);
  return applyAction({issue,owner:REPO.split('/')[0],projects,
    read:async path=>{const x=await api('contents/'+path+'?ref=main');
      if(!x)return null;
      if(!SHA.test(x.sha)||x.encoding!=='base64')throw Error('Invalid source file');
      return {sha:x.sha,content:Buffer.from(x.content.replace(/\s/g,''),'base64').toString('utf8')};},
    write:async(path,content,sha)=>api('contents/'+path,{method:'PUT',body:JSON.stringify({
      message:'NextNudge agent action (#'+number+')',branch:'main',content:Buffer.from(content).toString('base64'),...(sha?{sha}:{})})}),
    listComments:comments,
    postComment:async(target,body)=>{await targetIssue(target,true);
      return api('issues/'+target.issue+'/comments',{method:'POST',body:JSON.stringify({body})});},
    comment:async body=>api('issues/'+number+'/comments',{method:'POST',body:JSON.stringify({body})}),
    close:async()=>api('issues/'+number,{method:'PATCH',body:JSON.stringify({state:'closed'})})
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
