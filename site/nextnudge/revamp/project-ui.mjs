// Project-only navigation and forms; v3 thread workspaces remain owned by app.mjs.
import {projectsMarkup,projectMarkup} from './screens.mjs';
import {newProject,addThread,updateFixtures} from './project-model.mjs';
import {localProjects,localProjectIssues,persistProject,projectForThread,recordProjectSha,readRemoteProject,discoverProjects,prepareProjectSave} from './project-store.mjs';
import {groundingPanel,projectGroundingText} from './grounding.mjs';
import {activeAgent} from './thread.mjs';
import {askInline} from '../inline-question.mjs';
import {readRemote} from './save.mjs';
import {masterLogMarkup} from './master-log.mjs';
const DRAFT='nextnudge.project.grounding.drafts.v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=q=>document.querySelector(q);
const drafts=()=>{try{return JSON.parse(localStorage.getItem(DRAFT)||'{}');}catch{return {};}};
const fixtureInput=form=>Object.fromEntries([...new FormData(form)].filter(([key])=>key.startsWith('ground-'))
  .map(([key,value])=>[key.slice(7),value]));
export function createProjectUI({state,put,render,notice}){
  const current=()=>state.projects[state.activeProject]||null;
  function route(){
    if(typeof window==='undefined'||!window.history?.replaceState)return;
    const url=new URL(window.location.href);
    url.searchParams.delete('thread');url.searchParams.delete('workspace');
    if(state.activeProject)url.searchParams.set('project',state.activeProject);
    else url.searchParams.delete('project');
    if(state.view==='project-grounding')url.searchParams.set('projectView','grounding');
    else if(state.view==='project-master-log')url.searchParams.set('projectView','master-log');
    else url.searchParams.delete('projectView');
    window.history.replaceState(null,'',url);
  }
  function save(p){persistProject(p);state.projects[p.id]=p;state.activeProject=p.id;return p;}
  function show(){
    const p=current();
    if(state.view==='projects'){$('#panel').innerHTML=projectsMarkup(state.projects,state.threads);return;}
    if(state.view==='project'){
      if(!p){state.view='projects';return show();}
      $('#panel').innerHTML=projectMarkup(p,state.threads,state.projects);return;
    }
    if(state.view==='project-master-log'){
      if(!p)throw Error('Select a project first');
      $('#panel').innerHTML=masterLogMarkup(p,state.threads,state.masterLogRemote||{},state.masterLogLimit||100,!!state.masterLogLoading);
      return;
    }
    if(state.view==='project-grounding'){
      if(!p)throw Error('Select a project first');
      const draft=drafts()[p.id],saved=p.fixtures;
      const keys=new Set([...Object.keys(draft||{}),...Object.keys(saved)]);
      const dirty=!!draft&&[...keys].some(k=>String(draft[k]||'').trim()!==(saved[k]||''));
      $('#panel').innerHTML=groundingPanel(null,draft||saved,dirty,p);return;
    }
    if(state.view==='legacy-grounding'){
      const x=state.threads[state.active],history=x.moves.filter(m=>m.note?.startsWith('GROUNDING_FIXTURES_V1:'));
      $('#panel').innerHTML='<div class="heading"><button data-action="thread">← Thread</button><h2>Historical Grounding Fixtures · read-only</h2></div>'+
        '<p>Unassigned legacy threads have no project library. Attach explicitly to edit shared fixtures; historical versions are not merged.</p>'+
        history.map(m=>'<details><summary>'+esc(m.id)+' · historical snapshot</summary><pre>'+
        esc(JSON.stringify(JSON.parse(m.note.slice('GROUNDING_FIXTURES_V1:'.length)),null,2))+'</pre></details>').join('');
    }
  }
  function select(id){if(!state.projects[id])throw Error('Project not found');state.activeProject=id;state.view='project';state.draft=null;route();render();}
  function selectThreadProject(id){
    try{state.activeProject=projectForThread(id,state.projects)?.id||null;}
    catch(e){
      if(!/Ambiguous project association/.test(e.message))throw e;
      state.activeProject=null;
      state.message='Ambiguous project association; historical thread opened without assigning either project or its shared grounding.';
    }
  }
  async function refreshMasterLog(){
    const project=current();if(!project||state.masterLogLoading)return;
    state.masterLogRemote ||= {};state.masterLogLoading=true;render();
    try{
      // Read existing GitHub thread files, never alter device drafts or write new log data.
      for(let i=0;i<project.threads.length;i+=4){
        const group=project.threads.slice(i,i+4);
        await Promise.all(group.map(async row=>{
          try{
            const result=await readRemote(row.id);
            state.masterLogRemote[row.id]=result.thread?
              {thread:result.thread,sha:result.sha}:{error:'Thread file not saved to GitHub'};
          }catch(e){state.masterLogRemote[row.id]={error:'GitHub read unavailable: '+e.message};}
        }));
        if(state.view==='project-master-log'&&current()?.id===project.id)render();
      }
    }finally{
      state.masterLogLoading=false;
      if(state.view==='project-master-log'&&current()?.id===project.id)render();
    }
  }
  function createError(form,error){
    const target=form.querySelector('#new-thread-error');
    if(!target)return;
    target.textContent=error.message;
    target.focus();
    target.scrollIntoView({block:'nearest'});
  }
  function prepareThread(x){
    const p=current();
    if(!p)throw Error('Select a project');
    return addThread(p,x);
  }
  function submit(form,values){
    if(form.id==='new-project'){
      save(newProject(values.get('name').trim()));state.view='project';route();render();return true;
    }
    if(form.id==='project-grounding-form'){
      const p=current(),next=updateFixtures(p,fixtureInput(form));
      if(next)save(next);
      const rows=drafts();delete rows[p.id];
      try{localStorage.setItem(DRAFT,JSON.stringify(rows));}catch{}
      render();notice(next?'Project grounding saved locally as one version. Save project to GitHub for sharing.':'Project grounding unchanged; no history added.');return true;
    }
    if(form.id==='attach-thread'){
      const id=values.get('thread'),thread=state.threads[id],p=current();
      if(!thread)throw Error('Thread is not on this device; load it first');
      if(projectForThread(id,state.projects))throw Error('Thread already belongs to a project');
      save(addThread(p,{id,agent:activeAgent(thread)||'UNKNOWN'},{legacy:true}));
      state.view='project';render();return true;
    }
    return false;
  }
  async function action(name){
    if(name==='projects'){state.view='projects';state.activeProject=null;state.draft=null;route();render();return true;}
    if(name==='project'){state.view='project';state.draft=null;route();render();return true;}
    if(name==='project-grounding'){state.view='project-grounding';state.draft=null;route();render();return true;}
    if(name==='master-log'){state.view='project-master-log';state.masterLogLimit=100;state.draft=null;route();render();await refreshMasterLog();return true;}
    if(name==='master-log-refresh'){await refreshMasterLog();return true;}
    if(name==='master-log-more'){state.masterLogLimit=(state.masterLogLimit||100)+100;render();return true;}
    if(name==='back'){state.view=state.activeProject?'project':'projects';
      state.draft=null;state.editor=null;route();render();return true;}
    if(name==='copy-project-grounding'){
      const text=projectGroundingText(current(),fixtureInput($('#project-grounding-form')));
      try{await navigator.clipboard.writeText(text);notice('Project grounding copied. Copy does not send.');}
      catch{const box=document.createElement('textarea');box.value=text;box.readOnly=true;
        $('#project-grounding-form').appendChild(box);box.select();notice('Clipboard denied; selected manual copy text.');}
      return true;
    }
    if(name==='project-save'){
      const p=current();if(!p)throw Error('Select a project');
      const win=window.open('about:blank','_blank');
      try{
        const prepared=await prepareProjectSave(p);
        if(prepared.manual){
          const host=document.createElement('section'),label=document.createElement('label'),box=document.createElement('textarea');
          label.textContent='Manual Owner issue body · copy all text into the GitHub issue before submitting';
          box.value=prepared.body;box.readOnly=true;box.rows=8;
          label.appendChild(box);host.appendChild(label);$('#panel').appendChild(host);
          try{await navigator.clipboard.writeText(prepared.body);}
          catch{box.focus();box.select();}
        }
        if(win){win.opener=null;win.location.replace(prepared.url);}
        else{const a=document.createElement('a');a.href=prepared.url;a.target='_blank';a.rel='noopener noreferrer';
          a.textContent='Open prepared project save';$('#panel').append(a);}
        notice(prepared.manual?'Manual Owner issue body prepared. Paste the full body into GitHub; nothing sent yet. Device draft retained.':
          'Owner review request prepared ('+prepared.chars+' URL characters). Draft retained until confirmed GitHub readback.');
      }catch(e){win?.close();throw e;}
      return true;
    }
    if(name==='project-reload'){
      const p=current(),remote=await readRemoteProject(p.id);
      if(!remote.project){notice('Project not yet on GitHub. Device draft retained.');return true;}
      if(!(await askInline({title:'GitHub project readback',message:'Replace local project draft with GitHub content? Preserve unsaved work separately.',accept:'Replace'})).ok)return true;
      save(remote.project);recordProjectSha(p.id,remote.sha);state.view='project';
      render();notice('GitHub project readback verified at SHA '+remote.sha.slice(0,10)+'.');return true;
    }
    return false;
  }
  async function discover(){
    const issues=localProjectIssues();
    if(issues.invalid)state.message=issues.invalid+' invalid local project record(s) preserved; valid projects remain available. Export storage before repair.';
    try{const found=await discoverProjects();state.projects=localProjects();
      if(found.conflicts)state.message=(state.message||'')+' '+found.conflicts+' project GitHub revisions differ from device drafts; compare before writing.';
    }catch(e){state.message=(state.message||'')+' Project GitHub discovery unavailable: '+e.message+'. Device drafts retained.';}
  }
  document.addEventListener('input',event=>{
    if(event.target.closest?.('#new-thread')){
      const target=event.target.closest('#new-thread').querySelector('#new-thread-error');
      if(target)target.textContent='';
    }
    if(!event.target.closest?.('#project-grounding-form'))return;
    try{const rows=drafts();rows[state.activeProject]=fixtureInput($('#project-grounding-form'));
      localStorage.setItem(DRAFT,JSON.stringify(rows));
      const status=$('.grounding-status');if(status)status.textContent='Unsaved device draft';
    }catch(e){notice('Project grounding draft storage failed: '+e.message+'. Copy before leaving.');}
  });
  return {current,save,show,select,selectThreadProject,createError,prepareThread,submit,action,discover,route,refreshMasterLog,
    projectForActive:()=>state.active?projectForThread(state.active,state.projects):null};
}
