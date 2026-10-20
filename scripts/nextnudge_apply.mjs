import {assertScratchRun,assertScratchApi} from './nextnudge_scratch_guard.mjs';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {applyDelta,fingerprint,PATH} from '../site/nextnudge/repository.mjs';
import {validate} from '../site/nextnudge/schema.mjs';

const LIMIT=200_000;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
export function ownerIssue(issue,owner) {
  return issue?.user?.login===owner && Array.isArray(issue.labels) &&
    issue.labels.some(label=>(typeof label==='string'?label:label.name)==='nextnudge-save') &&
    !issue.pull_request;
}
export function unpack(body) {
  if(typeof body!=='string'||body.length>300_000)throw Error('invalid or oversized issue body');
  const matches=[...body.matchAll(/```nextnudge-save\s*\n([A-Za-z0-9+/=\r\n]+)\n```/g)];
  if(matches.length!==1)throw Error('expected one nextnudge-save packet');
  const data=matches[0][1].replace(/\s/g,'');
  if(!data||data.length>280_000||data.length%4!==0||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw Error('packet is not canonical base64');
  }
  let packet;
  try {
    const json=gunzipSync(Buffer.from(data,'base64'),{maxOutputLength:LIMIT}).toString('utf8');
    packet=JSON.parse(json);
  } catch {throw Error('invalid gzip or decoded packet exceeds 200 KB');}
  if(packet?.v!==1||!SHA.test(packet.baseSha||'')||!DIGEST.test(packet.digest||'')||
     !Number.isSafeInteger(packet.baseRevision)||!Number.isSafeInteger(packet.revision)||
     !packet.delta||typeof packet.delta!=='object')throw Error('packet header is invalid');
  return packet;
}
// Only a prior, unreceipted Owner save can be superseded here. Newer issue
// numbers may still be queued, so a running save must never close them.
export const SUPERSEDED_RECEIPT=
  'NEEDS RELOAD: this save was superseded before it ran. Nothing was written. Prepare a fresh save.';
const RECEIPT=/^(?:SAVED:|NEEDS RELOAD:|REJECTED:)/;
const RECEIPT_AUTHOR='github-actions[bot]';
export async function sweepUnreceipted({owner,currentIssueNumber,listOpenIssues,
  listComments,commentIssue,closeIssue}) {
  if(!Number.isSafeInteger(currentIssueNumber))throw Error('Missing current issue number');
  // Snapshot every page before closing anything: closing page-1 issues shifts
  // offset-based pagination and would otherwise skip unreceipted page-2 issues.
  const candidates=[];
  for(let page=1;;page++) {
    const issues=await listOpenIssues(page);
    if(!Array.isArray(issues))throw Error('Invalid open issue listing');
    if(!issues.length)break;
    candidates.push(...issues);
  }
  let swept=0;
  for(const candidate of candidates) {
      if(/```nextnudge-(?:thread-(?:save|action)|project-save)\s*\n/.test(candidate.body||'')||
         !ownerIssue(candidate,owner)||candidate.state!=='open'||
         !Number.isSafeInteger(candidate.number)||candidate.number>=currentIssueNumber)continue;
      let receipted=false;
      for(let commentPage=1;;commentPage++) {
        const comments=await listComments(candidate.number,commentPage);
        if(!Array.isArray(comments))throw Error('Invalid issue comments');
        if(comments.some(c=>c.user?.login===RECEIPT_AUTHOR &&
          RECEIPT.test(c.body||''))) {receipted=true;break;}
        if(!comments.length)break;
      }
      if(receipted)continue;
      await commentIssue(candidate.number,SUPERSEDED_RECEIPT);
      await closeIssue(candidate.number);
      swept++;
  }
  return swept;
}
export async function applyIssue({issue,owner,readCurrent,writeCurrent,comment,close}) {
  if(!ownerIssue(issue,owner)||issue.state==='closed')return 'IGNORED';
  let receipt,kind='REJECTED';
  try {
    const packet=unpack(issue.body);
    const current=await readCurrent();
    if(current.sha!==packet.baseSha) {
      kind='NEEDS RELOAD';
      receipt=`NEEDS RELOAD: GitHub changed since your draft (base ${packet.baseSha.slice(0,8)}, now ${current.sha.slice(0,8)}). Nothing written.`;
    } else {
      const next=applyDelta(validate(current.db),packet);
      const digest=await fingerprint(next);
      if(digest!==packet.digest)throw Error('digest mismatch');
      const bytes=JSON.stringify(next,null,2)+'\n';
      try {
        const saved=await writeCurrent(bytes,current.sha,packet.revision,issue.number);
        kind='SAVED';
        receipt=`SAVED: ${saved.url} · revision ${packet.revision} · digest ${digest.slice(0,8)}`;
      } catch(e) {
        if(e.status===409||e.status===422) {
          kind='NEEDS RELOAD';
          receipt='NEEDS RELOAD: GitHub changed during the commit. Nothing written.';
        } else throw e;
      }
    }
  } catch(e) {
    receipt=`REJECTED: ${String(e.message||e).replace(/[\r\n]/g,' ').slice(0,220)}. Nothing written.`;
  }
  await comment(receipt);
  await close();
  return kind;
}
async function api(path,options={}) {
  const token=process.env.GH_TOKEN;
  if(!token)throw Error('GH_TOKEN is required');
  const response=await fetch(assertScratchApi(process.env.GITHUB_REPOSITORY,path,options),{
    ...options,headers:{Accept:'application/vnd.github+json',
      Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',
      ...(options.body?{'Content-Type':'application/json'}:{})}});
  const json=await response.json().catch(()=>({}));
  if(!response.ok) {
    const error=Error('GitHub API '+response.status);
    error.status=response.status;throw error;
  }
  return json;
}
export async function main() {
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  assertScratchRun(process.env.GITHUB_REPOSITORY,event.repository?.full_name);
  if(/\x60\x60\x60nextnudge-project-save\s*\n/.test(event.issue?.body||'')) {
    const projects=await import('./nextnudge_project_apply.mjs');
    return projects.main();
  }
  if(/```nextnudge-thread-action\s*\n/.test(event.issue?.body||'')) {
    const action=await import('./nextnudge_action_apply.mjs');
    return action.main();
  }
  if(/```nextnudge-thread-save\s*\n/.test(event.issue?.body||'')) {
    const thread=await import('./nextnudge_thread_apply.mjs');
    return thread.main();
  }
  const number=event.issue?.number;
  if(!Number.isSafeInteger(number))throw Error('Missing issue number');
  const repoOwner=process.env.GITHUB_REPOSITORY.split('/')[0];
  const issue=await api('issues/'+number);
  const status=await applyIssue({
    issue,owner:repoOwner,
    readCurrent:async()=>{
      const entry=await api('contents/'+PATH+'?ref=main');
      if(!SHA.test(entry.sha)||entry.encoding!=='base64'||!entry.content)
        throw Error('Main workbench blob is unavailable');
      return {sha:entry.sha,db:JSON.parse(Buffer.from(entry.content.replace(/\s/g,''),'base64').toString('utf8'))};
    },
    writeCurrent:async(text,sha,revision,issueNo)=>{
      const result=await api('contents/'+PATH,{
        method:'PUT',body:JSON.stringify({message:`NextNudge save r${revision} (#${issueNo})`,
          branch:'main',sha,content:Buffer.from(text,'utf8').toString('base64')})
      });
      return {url:result.commit?.html_url||`https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${result.commit.sha}`};
    },
    comment:async(body)=>{await api('issues/'+number+'/comments',{method:'POST',body:JSON.stringify({body})});},
    close:async()=>{await api('issues/'+number,{method:'PATCH',body:JSON.stringify({state:'closed'})});}
  });
  if(status!=='IGNORED') {
    const swept=await sweepUnreceipted({
      owner:repoOwner,currentIssueNumber:number,
      listOpenIssues:page=>api('issues?state=open&labels=nextnudge-save&sort=created&direction=asc&per_page=100&page='+page),
      listComments:(issueNo,page)=>api('issues/'+issueNo+'/comments?per_page=100&page='+page),
      commentIssue:(issueNo,body)=>api('issues/'+issueNo+'/comments',{
        method:'POST',body:JSON.stringify({body})}),
      closeIssue:issueNo=>api('issues/'+issueNo,{
        method:'PATCH',body:JSON.stringify({state:'closed'})})
    });
    console.log('Superseded older unreceipted Owner saves:',swept);
  }
  console.log('NextNudge save result:',status);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{console.error('NextNudge save handler failed:',e.message);process.exitCode=1;});
}
