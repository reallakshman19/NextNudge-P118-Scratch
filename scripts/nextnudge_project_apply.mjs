import {assertScratchRun,assertScratchApi} from './nextnudge_scratch_guard.mjs';
import {gunzipSync} from 'node:zlib';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PROJECT_ID,validateProject,assertAppendOnly} from '../site/nextnudge/revamp/project-model.mjs';
import {parse,activeAgent} from '../site/nextnudge/revamp/thread.mjs';
const SHA=/^[a-f0-9]{40}$/,ROOT='site/nextnudge-data/projects/';
export function unpackProject(body){
  if(typeof body!=='string'||body.length>100000)throw Error('Invalid project request');
  const matches=[...body.matchAll(/```nextnudge-project-save\n([A-Za-z0-9+/=\r\n]+)\n```/g)];
  if(matches.length!==1)throw Error('Expected one project packet');
  const encoded=matches[0][1].replace(/\s/g,'');
  if(encoded.length>90000||encoded.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw Error('Noncanonical project packet');
  let packet;
  try{packet=JSON.parse(gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:350000}).toString('utf8'));}
  catch{throw Error('Malformed or oversized project packet');}
  if(packet?.v!==1||!PROJECT_ID.test(packet.id)||
    (packet.baseSha!==null&&!SHA.test(packet.baseSha))||
    packet.project?.id!==packet.id)throw Error('Invalid project packet');
  validateProject(packet.project);return packet;
}
export async function applyProjectIssue({issue,owner,read,write,comment,close}){
  if(issue?.user?.login!==owner||issue.state!=='open'||issue.pull_request||
    !issue.labels?.some(x=>(typeof x==='string'?x:x.name)==='nextnudge-save'))return 'IGNORED';
  let result,message;
  try{
    const packet=unpackProject(issue.body),file=await read(ROOT+packet.id+'.json');
    if((file?.sha||null)!==packet.baseSha){
      result='NEEDS RELOAD';message='NEEDS RELOAD: project SHA changed. Nothing written.';
    }else{
      const original=file?validateProject(JSON.parse(file.content)):null;
      const next=assertAppendOnly(original,packet.project);
      // Authoritative check at write time: no public project may reference device-only threads.
      // A browser preflight alone is not sufficient; the Owner issue can be modified or delayed.
      for(const member of next.threads){
        const source=await read('site/nextnudge-data/threads/'+member.id+'.md');
        if(!source||!SHA.test(source.sha||''))
          throw Error('THREAD_FIRST: save '+member.agent+' ('+member.id+') to GitHub before project publication');
        const thread=parse(source.content);
        if(thread.id!==member.id)throw Error('THREAD_FIRST: linked thread identity mismatch '+member.id);
        if(!member.legacy&&activeAgent(thread).trim().toLowerCase()!==member.agent.trim().toLowerCase())
          throw Error('THREAD_FIRST: active agent differs for '+member.id);
      }
      const contents=JSON.stringify(next,null,2)+'\n';
      if(JSON.stringify(validateProject(JSON.parse(contents)))!==JSON.stringify(next))
        throw Error('Project round-trip failed');
      await write(ROOT+packet.id+'.json',contents,file?.sha||null);
      result='SAVED';message='SAVED: '+ROOT+packet.id+'.json · '+next.threads.length+' threads, '+next.snapshots.length+' fixture versions';
    }
  }catch(e){
    const conflict=e?.status===409||e?.status===422;
    result=conflict?'NEEDS RELOAD':'REJECTED';
    message=result+': '+(conflict?'concurrent project edit':String(e.message||e).slice(0,180))+' · Nothing written.';
  }
  await comment(message);await close();return result;
}
async function api(path,options={}){
  const response=await fetch(assertScratchApi(process.env.GITHUB_REPOSITORY,path,options),{
    ...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN,
      'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}});
  if(response.status===404)return null;
  const value=await response.json().catch(()=>({}));
  if(!response.ok){const error=Error('GitHub API '+response.status);error.status=response.status;throw error;}
  return value;
}
export async function main(){
  if(!process.env.GH_TOKEN||!process.env.GITHUB_REPOSITORY)throw Error('Missing Actions identity');
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  assertScratchRun(process.env.GITHUB_REPOSITORY,event.repository?.full_name);
  const issue=await api('issues/'+event.issue.number);
  return applyProjectIssue({issue,owner:process.env.GITHUB_REPOSITORY.split('/')[0],
    read:async path=>{
      const d=await api('contents/'+path+'?ref=main');
      if(!d)return null;
      if(!SHA.test(d.sha)||d.encoding!=='base64')throw Error('Invalid project source');
      return {sha:d.sha,content:Buffer.from(d.content.replace(/\s/g,''),'base64').toString('utf8')};
    },
    write:async(path,content,sha)=>api('contents/'+path,{method:'PUT',body:JSON.stringify({
      message:'NextNudge project save (#'+issue.number+')',branch:'main',
      content:Buffer.from(content,'utf8').toString('base64'),...(sha?{sha}:{})})}),
    comment:async body=>api('issues/'+issue.number+'/comments',{method:'POST',body:JSON.stringify({body})}),
    close:async()=>api('issues/'+issue.number,{method:'PATCH',body:JSON.stringify({state:'closed'})})
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{console.error(e);process.exitCode=1;});
