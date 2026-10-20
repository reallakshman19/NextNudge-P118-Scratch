import {activeIntent} from './thread.mjs';
import {MODES,defaults,valuesFor,workspaceMove,workspaceBasis,buildWorkspacePacket} from './workspace.mjs';
import {readWorkspaceDraft,writeWorkspaceDraft,clearWorkspacePacket} from './workspace-drafts.mjs';
import {restoreComposer} from './composer.mjs';
import {workspaceView} from './workspace-view.mjs';
const $=q=>document.querySelector(q);
function status(ctx,text){const el=$('#workspace-status');if(el)el.textContent=text;ctx.notice(text);}
function saveDevice(ctx){
  if(ctx.state.view!=='workspace')return;
  writeWorkspaceDraft(ctx.t().id,ctx.state.workspaceMode,{values:ctx.state.workspaceValues,draft:ctx.state.draft});
}
function formValues(ctx){return valuesFor(ctx.state.workspaceMode,Object.fromEntries(new FormData($('#workspace-form'))));}
function tabURL(ctx,mode){
  if(typeof window==='undefined')return;
  const url=new URL(window.location.href);url.searchParams.set('thread',ctx.t().id);
  if(mode)url.searchParams.set('workspace',mode);else url.searchParams.delete('workspace');
  window.history.replaceState(null,'',url);
}
export function openWorkspace(ctx,mode){
  if(!MODES.includes(mode))throw Error('Unknown workspace');
  saveDevice(ctx);
  const thread=ctx.t(),cached=readWorkspaceDraft(thread.id,mode),value=defaults(thread,mode);
  Object.assign(value,cached?.values||{});
  if(mode==='reconcile'&&value.basis!==JSON.stringify(activeIntent(thread).doneWhen)){
    value.basis=JSON.stringify(activeIntent(thread).doneWhen);
    for(let n=0;n<5;n++)value['check'+n]='unknown';
  }
  const legacy=restoreComposer(thread.id);
  let draft=cached?.draft||(!cached&&legacy?.kind===mode&&!legacy.workspaceMode?legacy:null);
  if(draft&&thread.moves.some(m=>m.id===draft.id&&m.delivery==='sent'))draft=null;
  Object.assign(ctx.state,{view:'workspace',workspaceMode:mode,workspaceValues:value,draft,editor:null});
  ctx.render();tabURL(ctx,mode);$('#workspace-title')?.focus();
}
export function workspaceMarkup(ctx){
  return workspaceView(ctx.t(),ctx.state.workspaceMode,ctx.state.workspaceValues,ctx.state.draft);
}
export function checkWorkspacePacket(ctx){
  const d=ctx.state.draft;if(!d?.workspaceMode)return;
  const mode=d.workspaceMode;
  const values=ctx.state.view==='workspace'&&ctx.state.workspaceMode===mode?ctx.state.workspaceValues:
    readWorkspaceDraft(ctx.t().id,mode)?.values||defaults(ctx.t(),mode);
  if(d.workspaceBasis!==workspaceBasis(ctx.t(),mode,values))
    throw Error('Workspace fields or Owner context changed. Build an updated packet before copying or sending.');
}
export function clearSentWorkspace(ctx,move){
  if(move.delivery==='sent'&&ctx.state.draft?.workspaceMode)
    clearWorkspacePacket(ctx.t().id,ctx.state.draft.workspaceMode);
}
export async function workspaceAction(action,ctx){
  const old={ 'compose-ground':'ground','compose-task':'task','compose-correction':'correction',review:'reconcile','compose-close':'reconcile'};
  const mode=old[action]|| (action.startsWith('workspace-')?action.slice(10):null);
  if(MODES.includes(mode)){openWorkspace(ctx,mode);return true;}
  if(['thread','back','grounding'].includes(action)){
    saveDevice(ctx);if(action!=='grounding')tabURL(ctx,null);
  }
  if(['copy-packet','record-sent','send-github'].includes(action)){
    try{checkWorkspacePacket(ctx);}catch(e){
      status(ctx,e.message);const el=$('#packet-status');if(el)el.textContent=e.message;throw e;
    }
  }
  if(action==='workspace-build'){
    try{
      ctx.state.workspaceValues=formValues(ctx);
      const draft=buildWorkspacePacket(ctx.t(),ctx.state.workspaceMode,ctx.state.workspaceValues);
      writeWorkspaceDraft(ctx.t().id,ctx.state.workspaceMode,{values:ctx.state.workspaceValues,draft});
      ctx.state.draft=draft;ctx.render();
      $('#packet')?.focus();$('#packet')?.scrollIntoView({block:'nearest'});
      status(ctx,'Packet prepared on this device. Copying does not send it.');
    }catch(e){status(ctx,'Packet not built: '+e.message);}
    return true;
  }
  return false;
}
export function installWorkspaces(ctx){
  function capture(event,refresh=false){
    if(ctx.state.view!=='workspace')return;
    if(!refresh&&event.target.tagName==='SELECT')return;
    const inForm=event.target.closest('#workspace-form');
    if(!inForm&&event.target.id!=='packet')return;
    try{
      if(inForm){
        const before=ctx.state.workspaceValues.target,next=formValues(ctx);
        if(ctx.state.workspaceMode==='reconcile'&&before!==next.target)
          for(let n=0;n<5;n++)next['check'+n]='unknown';
        ctx.state.workspaceValues=next;
      }
      else if(ctx.state.draft)ctx.state.draft.packet=event.target.value;
      saveDevice(ctx);
      let stale=false;
      try{checkWorkspacePacket(ctx);}catch{stale=true;}
      const text=stale?'Device draft saved. Fields changed; build an updated packet.':'Draft saved on this device.';
      if(refresh&&['target','groundId'].includes(event.target.name)){
        const name=event.target.name;ctx.render();$('#workspace-form')?.elements.namedItem(name)?.focus();
      }
      const el=$('#workspace-status');if(el)el.textContent=text;
      const note=$('#workspace-packet-note');if(note)note.textContent=stale?'This packet predates the current fields. Build it again before delivery.':'';
    }catch(e){status(ctx,'Device draft could not be stored: '+e.message+'. Keep this page open and copy your fields before leaving.');}
  }
  document.addEventListener('input',e=>capture(e));
  document.addEventListener('change',e=>capture(e,true));
  document.addEventListener('submit',event=>{
    if(event.target.id!=='workspace-form')return;event.preventDefault();
    try{
      const mode=ctx.state.workspaceMode,value=formValues(ctx),draft=ctx.state.draft;
      ctx.state.workspaceValues=value;saveDevice(ctx);
      const move=workspaceMove(ctx.t(),mode,value);
      if(move)ctx.append(move);
      ctx.state.draft=draft;ctx.render();
      status(ctx,move?'Saved '+mode+' locally as one version. Publish to GitHub from Overview.':'Unchanged; no history entry added.');
    }catch(e){status(ctx,'Workspace not saved: '+e.message);}
  });
}
