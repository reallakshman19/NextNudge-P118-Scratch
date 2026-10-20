// Read-only authority used by existing Owner issue writers; no extra workflow or state.
import {PROJECT_ID,validateProject} from '../site/nextnudge/revamp/project-model.mjs';
import {assertProjectAgent} from '../site/nextnudge/revamp/project-store.mjs';
const ROOT='site/nextnudge-data/projects';
export function checkManagedSend(thread,agent,projects){
  return assertProjectAgent(thread,agent,projects);
}
export async function loadRemoteProjects(api){
  const items=await api('contents/'+ROOT+'?ref=main');
  if(items===null)return {};
  if(!Array.isArray(items))throw Error('Invalid GitHub project listing');
  const projects={};
  for(const entry of items){
    const id=entry.name?.replace(/\.json$/,'');
    if(!PROJECT_ID.test(id)||entry.name!==id+'.json')continue;
    const blob=await api('contents/'+ROOT+'/'+id+'.json?ref=main');
    if(!blob||blob.encoding!=='base64'||!/^[0-9a-f]{40}$/.test(blob.sha||''))
      throw Error('Invalid GitHub project blob '+id);
    const p=validateProject(JSON.parse(Buffer.from(blob.content.replace(/\s/g,''),'base64').toString('utf8')));
    if(p.id!==id)throw Error('GitHub project path mismatch '+id);
    projects[id]=p;
  }
  return projects;
}
