import {assertScratchRun,assertScratchApi} from './nextnudge_scratch_guard.mjs';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {parse,serialize,assertPublic,THREAD_ID} from '../site/nextnudge/revamp/thread.mjs';
import {applyDelta,ROOT} from '../site/nextnudge/revamp/save.mjs';
import {checkManagedSend,loadRemoteProjects} from './nextnudge_project_guard.mjs';
const SHA=/^[0-9a-f]{40}$/;
const OWNER_LABEL='nextnudge-save';
export function ownerIssue(issue,owner) {
  return issue?.user?.login===owner && issue.state==='open'&&!issue.pull_request&&
    issue.labels?.some(l=>(typeof l==='string'?l:l.name)===OWNER_LABEL);
}
export function unpack(body) {
  if(typeof body!=='string'||body.length>100000)throw Error('Invalid issue body');
  const re=new RegExp(''+String.fromCharCode(96).repeat(3)+'nextnudge-thread-save\\n([A-Za-z0-9+/=\\r\\n]+)\\n'+String.fromCharCode(96).repeat(3),'g');
  const matches=[...body.matchAll(re)];
  if(matches.length!==1)throw Error('Expected one thread packet');
  const encoded=matches[0][1].replace(/\s/g,'');
  if(encoded.length>90000||encoded.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw Error('Noncanonical packet');
  let packet;
  try{packet=JSON.parse(gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:200000}).toString('utf8'));}
  catch{throw Error('Malformed or oversized compressed packet');}
  if(packet?.v!==3||!THREAD_ID.test(packet.id)||packet.baseSha!==null&&!SHA.test(packet.baseSha)||
    !Number.isSafeInteger(packet.expectedCount)||packet.expectedCount<0||
    !Array.isArray(packet.moves)||packet.moves.length>50)throw Error('Invalid thread packet');
  assertPublic(packet);
  return packet;
}
export async function applyIssue({issue,owner,read,write,comment,close,projects={}}) {
  if(!ownerIssue(issue,owner))return 'IGNORED';
  let result='REJECTED',message;
  try{
    const packet=unpack(issue.body),file=await read(ROOT+packet.id+'.md');
    if((file?.sha||null)!==packet.baseSha){
      result='NEEDS RELOAD';message='NEEDS RELOAD: file changed. Nothing written.';
    }else{
      const source=file?parse(file.content):null;
      const markdown=applyDelta(source,packet);
      if(!markdown.startsWith('# ')||markdown.length>2000000)throw Error('Invalid thread output');
      // Never persist a document the actual reader cannot fully reconstruct.
      const rebuilt=parse(markdown);
      for(const move of packet.moves.filter(m=>m.delivery==='sent'))checkManagedSend(rebuilt,move.agent,projects);
      if(serialize(rebuilt)!==markdown)throw Error('Thread Markdown does not round-trip');
      await write(ROOT+packet.id+'.md',markdown,file?.sha||null);
      result='SAVED';message='SAVED: '+ROOT+packet.id+'.md · appended '+packet.moves.length+' moves';
    }
  }catch(e){message=(e?.status===409||e?.status===422?'NEEDS RELOAD: concurrent write':'REJECTED: '+String(e.message||e).slice(0,180))+' · Nothing written.';result=message.startsWith('NEEDS RELOAD')?'NEEDS RELOAD':'REJECTED';}
  await comment(message);await close();
  return result;
}
async function api(path,opts={}) {
  const r=await fetch(assertScratchApi(process.env.GITHUB_REPOSITORY,path,opts),{
    ...opts,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN,
    'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}});
  if(r.status===404)return null;
  const value=await r.json().catch(()=>({}));
  if(!r.ok){const e=Error('GitHub API '+r.status);e.status=r.status;throw e;}
  return value;
}
export async function main() {
  if(!process.env.GH_TOKEN||!process.env.GITHUB_REPOSITORY)throw Error('Missing Actions identity');
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  assertScratchRun(process.env.GITHUB_REPOSITORY,event.repository?.full_name);
  const number=event.issue?.number;
  if(!Number.isSafeInteger(number))throw Error('No issue number');
  const issue=await api('issues/'+number),owner=process.env.GITHUB_REPOSITORY.split('/')[0];
  const projects=await loadRemoteProjects(api);
  return applyIssue({issue,owner,projects,
    read:async path=>{
      const data=await api('contents/'+path+'?ref=main');
      if(!data)return null;
      if(!SHA.test(data.sha)||data.encoding!=='base64'||!data.content)throw Error('Invalid existing file');
      return {sha:data.sha,content:Buffer.from(data.content.replace(/\s/g,''),'base64').toString('utf8')};
    },
    write:async(path,content,sha)=>{
      const body={message:'NextNudge thread append (#'+number+')',branch:'main',
        content:Buffer.from(content,'utf8').toString('base64'),...(sha?{sha}:{})};
      await api('contents/'+path,{method:'PUT',body:JSON.stringify(body)});
    },
    comment:async message=>{await api('issues/'+number+'/comments',{method:'POST',body:JSON.stringify({body:message})});},
    close:async()=>{await api('issues/'+number,{method:'PATCH',body:JSON.stringify({state:'closed'})});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
