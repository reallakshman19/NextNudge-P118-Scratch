import {assertScratchRepo} from './scratch-identity.mjs';
import {validateProject,PROJECT_ID,assertAppendOnly} from './project-model.mjs';
import {REPO,issueUrl,issueBody,readRemote} from './save.mjs';
import {activeAgent} from './thread.mjs';
const ROOT='site/nextnudge-data/projects/';
const LOCAL='nextnudge.projects.v1',SHAS='nextnudge.projects.sha.v1';
const readKey=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}};
function projectRecords(){
  let raw;
  try{raw=localStorage.getItem(LOCAL);}catch{return {rows:{},invalid:1,unreadable:true};}
  if(!raw)return {rows:{},invalid:0,unreadable:false};
  let rows;
  try{rows=JSON.parse(raw);}catch{return {rows:{},invalid:1,unreadable:true};}
  if(!rows||typeof rows!=='object'||Array.isArray(rows))
    return {rows:{},invalid:1,unreadable:true};
  let invalid=0;
  const valid={};
  for(const [id,p] of Object.entries(rows)){
    try{validateProject(p);if(id!==p.id)throw Error('Registry key does not match project');valid[id]=p;}
    catch{invalid++;}
  }
  return {rows,valid,invalid,unreadable:false};
}
export function localProjectIssues(){
  const result=projectRecords();
  return {invalid:result.invalid,unreadable:result.unreadable};
}
export function localProjects(){return projectRecords().valid||{};}
export function persistProject(p){
  validateProject(p);
  const records=projectRecords();
  if(records.unreadable)throw Error('Project registry is unreadable; original bytes preserved. Export or repair before another save.');
  // Preserve invalid entries in storage for recovery; only the known project entry changes.
  const rows={...records.rows,[p.id]:p};
  localStorage.setItem(LOCAL,JSON.stringify(rows));return p;
}
export function assertProjectAgent(thread,agent,projects=localProjects()){
  const project=projectForThread(thread.id,projects);
  if(!project)return null; // Historical unassigned v3 threads keep their original behavior.
  const binding=project.threads.find(row=>row.id===thread.id);
  if(typeof agent!=='string'||agent.trim().toLowerCase()!==binding.agent.trim().toLowerCase())
    throw Error('Project agent mismatch: this thread belongs to '+binding.agent+'. Open the intended agent thread.');
  return binding.agent;
}
export function projectForThread(threadId,projects=localProjects()){
  const matches=Object.values(projects).filter(p=>p.threads.some(t=>t.id===threadId));
  if(matches.length>1)throw Error('Ambiguous project association; resolve explicitly');
  return matches[0]||null;
}
export function projectSha(id){return readKey(SHAS)[id]||null;}
export function recordProjectSha(id,sha){
  if(sha!==null&&!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid project SHA');
  const rows=readKey(SHAS);rows[id]=sha;localStorage.setItem(SHAS,JSON.stringify(rows));
}
const path=id=>ROOT+id+'.json';
async function readFile(id){
  assertScratchRepo(REPO);
  if(!PROJECT_ID.test(id))throw Error('Invalid project ID');
  const response=await fetch('https://api.github.com/repos/'+REPO+'/contents/'+path(id)+'?ref=main',
    {cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
  if(response.status===404)return {project:null,sha:null};
  if(!response.ok)throw Error('GitHub project read failed '+response.status);
  const body=await response.json();
  if(!/^[a-f0-9]{40}$/.test(body.sha)||body.encoding!=='base64')throw Error('Invalid project blob');
  const bytes=Uint8Array.from(atob(body.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
  const project=validateProject(JSON.parse(new TextDecoder().decode(bytes)));
  if(project.id!==id)throw Error('Project path and ID differ');
  return {project,sha:body.sha};
}
export const readRemoteProject=readFile;
export async function discoverProjects(){
  assertScratchRepo(REPO);
  const url='https://api.github.com/repos/'+REPO+'/contents/'+ROOT.slice(0,-1)+'?ref=main';
  const response=await fetch(url,{cache:'no-store'});
  if(response.status===404)return {imported:0,conflicts:0};
  if(!response.ok)throw Error('GitHub project listing failed '+response.status);
  const list=await response.json(),local=localProjects();
  let imported=0,conflicts=0;
  for(const entry of list){
    const id=entry.name?.replace(/\.json$/,'');
    if(!PROJECT_ID.test(id)||entry.name!==id+'.json')continue;
    const remote=await readFile(id);
    if(!local[id]){persistProject(remote.project);recordProjectSha(id,remote.sha);imported++;}
    else if(projectSha(id)!==remote.sha)conflicts++;
  }
  return {imported,conflicts};
}
export async function verifyProjectThreads(project,load=readRemote){
  validateProject(project);
  for(const member of project.threads){
    const remote=await load(member.id);
    if(!remote?.thread||!/^[a-f0-9]{40}$/.test(remote.sha||''))
      throw Error('Save thread '+member.agent+' ('+member.id+') to GitHub and confirm readback before saving this project. Device drafts retained.');
    if(remote.thread.id!==member.id)
      throw Error('GitHub thread identity does not match project membership: '+member.id);
    if(!member.legacy&&activeAgent(remote.thread).trim().toLowerCase()!==member.agent.trim().toLowerCase())
      throw Error('Save the matching '+member.agent+' thread on GitHub before project publication. Device drafts retained.');
  }
  return true;
}
export async function prepareProjectSave(project){
  validateProject(project);
  await verifyProjectThreads(project);
  const remote=await readFile(project.id),known=projectSha(project.id);
  if(remote.sha!==known)throw Error('NEEDS RELOAD: GitHub project changed. Device draft retained.');
  assertAppendOnly(remote.project,project);
  const packet={v:1,id:project.id,baseSha:remote.sha,project};
  try{
    const url=await issueUrl(packet,'nextnudge-project-save');
    return {url,chars:url.length,packet,manual:false};
  }catch(e){
    if(!/exceeds one-click limit/.test(e.message))throw e;
    const body=await issueBody(packet,'nextnudge-project-save');
    if(body.length>65000)throw Error('Project snapshot exceeds GitHub issue-body limit. Device draft retained; export and request a reviewed source-file save.');
    const url='https://github.com/'+REPO+'/issues/new?labels=nextnudge-save&title='+
      encodeURIComponent('NextNudge project '+packet.id);
    return {url,chars:url.length,packet,manual:true,body};
  }
}
