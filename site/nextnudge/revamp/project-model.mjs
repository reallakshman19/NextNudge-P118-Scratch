// Project membership and shared fixtures are separate from immutable v3 thread history.
import {HEADINGS,RETIRED_MIDCYCLE_KEYS} from '../fixtures.mjs';
import {THREAD_ID,assertPublic,freshId} from './thread.mjs';
export const PROJECT_ID=/^NP-\d{8}-\d{6}-[a-f0-9]{4}$/;
const KEYS=new Set(HEADINGS.map(([,key])=>key));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function fixtureValues(values){
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid fixtures');
  const out={};
  for(const [key,val] of Object.entries(values)){
    if(!KEYS.has(key)||typeof val!=='string'||val.length>12000)throw Error('Invalid fixture heading or content');
    if(val.trim())out[key]=val.trim();
  }
  if(JSON.stringify(out).length>85000)throw Error('Fixture snapshot too long');
  assertPublic(out);return out;
}
export function validateProject(p){
  if(!p||p.version!==1||!PROJECT_ID.test(p.id)||typeof p.name!=='string'||
    !p.name.trim()||p.name.length>120||!Array.isArray(p.threads)||p.threads.length>200||
    !Array.isArray(p.snapshots)||p.snapshots.length>200)throw Error('Invalid project');
  if(Object.keys(p).some(key=>!['version','id','name','threads','fixtures','snapshots'].includes(key))||
     JSON.stringify(p).length>300000)throw Error('Unsupported or oversized project data');
  const ids=new Set(),agents=new Set();
  for(const row of p.threads){
    if(!row||Object.keys(row).some(key=>!['id','agent','legacy'].includes(key))||!THREAD_ID.test(row.id)||typeof row.agent!=='string'||!row.agent.trim()||
      row.agent.length>200||typeof row.legacy!=='boolean'||ids.has(row.id))
      throw Error('Invalid or repeated project thread');
    ids.add(row.id);
    const agent=row.agent.trim().toLowerCase();
    if(!row.legacy&&agents.has(agent))throw Error('Duplicate active agent');
    agents.add(agent);
  }
  const values=fixtureValues(p.fixtures);
  if(!same(values,p.fixtures))throw Error('Noncanonical project fixtures');
  for(const item of p.snapshots){
    if(!item||Object.keys(item).some(key=>!['at','values'].includes(key))||typeof item.at!=='string'||item.at.length>64||!/^\d{4}-\d\d-\d\dT/.test(item.at))
      throw Error('Invalid fixture snapshot date');
    if(!same(fixtureValues(item.values),item.values))throw Error('Noncanonical snapshot');
  }
  if(p.snapshots.length&&!same(p.snapshots.at(-1).values,p.fixtures))
    throw Error('Project fixture version mismatch');
  assertPublic(p);return p;
}
export function newProject(name,id=freshId().replace(/^NN-/,'NP-')){
  return validateProject({version:1,id,name:String(name).trim(),threads:[],fixtures:{},snapshots:[]});
}
export function addThread(p,thread,{legacy=false}={}){
  if(p.threads.some(row=>row.id===thread.id))throw Error('Thread is already in project');
  const agent=String(thread.agent||'').trim();
  if(!agent)throw Error('Agent name is required for project membership');
  if(!legacy&&p.threads.some(row=>row.agent.trim().toLowerCase()===agent.toLowerCase()))
    throw Error('Agent already has a project thread; open that thread instead');
  return validateProject({...p,threads:[...p.threads,{id:thread.id,agent,legacy}]});
}
export function updateFixtures(p,values,at=new Date().toISOString()){
  // Preserve retired 6/7-series values verbatim; removing fields from the
  // active form must never delete earlier Owner grounding or saved snapshots.
  const archived=Object.fromEntries(Object.entries(p.fixtures).filter(([k])=>RETIRED_MIDCYCLE_KEYS.has(k)));
  const next=fixtureValues({...archived,...values});
  if(same(p.fixtures,next))return null;
  return validateProject({...p,fixtures:next,snapshots:[...p.snapshots,{at,values:next}]});
}
export function conflicts(p){
  const rows=new Map(),duplicates=[];
  for(const row of p.threads){
    const key=row.agent.trim().toLowerCase();
    if(rows.has(key))duplicates.push([rows.get(key),row.id]);
    else rows.set(key,row.id);
  }
  return duplicates;
}
export function assertAppendOnly(before,next){
  validateProject(next);
  if(!before)return next;
  validateProject(before);
  if(before.id!==next.id||before.name!==next.name||
    next.threads.length<before.threads.length||next.snapshots.length<before.snapshots.length||
    !same(next.threads.slice(0,before.threads.length),before.threads)||
    !same(next.snapshots.slice(0,before.snapshots.length),before.snapshots))
    throw Error('Project history changed; reconcile instead of overwriting');
  if(next.snapshots.length===before.snapshots.length&&!same(next.fixtures,before.fixtures))
    throw Error('Fixture change requires a saved snapshot');
  if(next.snapshots.length===before.snapshots.length&&next.threads.length===before.threads.length)
    throw Error('Nothing new to save');
  return next;
}
