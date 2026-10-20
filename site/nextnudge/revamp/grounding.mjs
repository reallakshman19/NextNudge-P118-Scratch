import {HEADINGS,PROJECT_HEADINGS,PROJECT_PHASES,RETIRED_MIDCYCLE,RETIRED_MIDCYCLE_KEYS,projectHeadingNumber} from '../fixtures.mjs';
import {freshId,activeIntent,assertPublic,validate} from './thread.mjs';
import {workspaceNav} from './workspace-nav.mjs';
import {projectForThread} from './project-store.mjs';
const PREFIX='GROUNDING_FIXTURES_V1:';
const keys=new Set(HEADINGS.map(([,key])=>key));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function checked(values){
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid grounding');
  const out={};
  for(const [key,text] of Object.entries(values)){
    if(!keys.has(key))throw Error('Unknown grounding heading');
    if(typeof text!=='string'||text.length>12000)throw Error('Grounding item too long');
    if(text.trim())out[key]=text.trim();
  }
  if(JSON.stringify(out).length>85000)throw Error('Grounding snapshot too long');
  assertPublic(out);return out;
}
export function readGrounding(thread){
  const last=[...thread.moves].reverse().find(m=>m.kind==='amendment'&&m.note.startsWith(PREFIX));
  return last?checked(JSON.parse(last.note.slice(PREFIX.length))):{};
}
export function groundingMove(thread,values,id=freshId()){
  const next=checked(values),before=readGrounding(thread);
  if(HEADINGS.every(([,key])=>(before[key]||'')===(next[key]||'')))return null;
  const move={id,kind:'amendment',delivery:'draft',packet:'',returnLine:'',digest:'',
    evidence:'',gap:'',decision:'',archive:'',note:PREFIX+JSON.stringify(next)};
  validate({...thread,moves:[...thread.moves,move]});return move;
}
const activeValues=values=>Object.fromEntries(Object.entries(values).filter(([key])=>PROJECT_HEADINGS.some(([,k])=>k===key)));
export function effectiveGrounding(thread){
  if(!thread)return {};
  // Ambiguous legacy associations cannot select either project's fixtures.
  // Keep the original immutable thread grounding readable until the Owner resolves custody.
  try{
    const p=projectForThread(thread.id);
    return activeValues(p?p.fixtures:readGrounding(thread));
  }catch(e){
    if(/Ambiguous project association/.test(e.message))return activeValues(readGrounding(thread));
    throw e;
  }
}
export function projectGroundingText(project,values=project.fixtures){
  const checkedValues=checked(values);
  return ['Project grounding · '+project.name,
    ...PROJECT_HEADINGS.filter(([,key])=>checkedValues[key]).map(([,key,label])=>projectHeadingNumber(key)+'. '+label+'\n'+checkedValues[key])].join('\n\n');
}
export function groundingSummary(move){
  if(!move.note?.startsWith(PREFIX))return null;
  return 'Grounding updated · '+Object.keys(checked(JSON.parse(move.note.slice(PREFIX.length)))).length+' headings';
}
export function groundingText(thread){
  const i=activeIntent(thread),values=activeValues(readGrounding(thread));
  return ['Project grounding · '+thread.id,'Owner goal: '+i.goal,
    'In scope: '+i.inScope,'Out of scope: '+i.outScope,'HOLD: '+(i.hold||'OFF'),
    ...PROJECT_HEADINGS.filter(([,key])=>values[key]).map(([,key,label])=>projectHeadingNumber(key)+'. '+label+'\n'+values[key])].join('\n\n');
}
export function groundingPanel(thread,values=readGrounding(thread),hasDraft=false,project=null){
  const linkKeys=new Set(['1a','1b','1c','1d']);
  const historical=project?.fixtures||(thread?readGrounding(thread):{});
  const archived=RETIRED_MIDCYCLE.filter(([,key])=>historical[key]);
  const archiveView=archived.length?'<details><summary>Historical retired Midcycle context ('+archived.length+') · read-only</summary>'+
    '<p>Retained for history; not included in newly built agent packets or active fixture editing.</p>'+
    archived.map(([,key,title])=>'<p><strong>'+esc(key+'. '+title)+'</strong></p><pre>'+esc(historical[key])+'</pre>').join('')+
    '</details>':'';
  const actionsBar='<div class="grounding-actions">'+
    '<button type="submit" class="primary">Save grounding</button> '+
    '<button type="button" data-action="'+(project?'copy-project-grounding':'copy-grounding')+'">Copy grounding for agent</button> '+
    '<span class="grounding-status" role="status" aria-live="polite">'+(hasDraft?'Unsaved device draft restored':'')+'</span></div>';
  return '<div class="heading"><button data-action="'+(project?'project':'thread')+'">← '+(project?'Project':'Thread')+'</button><h2>Grounding Fixtures</h2></div>'+
    (project?'':workspaceNav('fixtures'))+
    '<p>Keep reusable context here. Master Log notes are optional context, not the derived project Master Log. Blank means UNKNOWN. Edits stay on this device while typing. &quot;Save grounding&quot; creates one local snapshot '+(project?'in this project':'in thread history')+'. Publish to GitHub '+(project?'from this project':'on Thread page')+'.'+(hasDraft?' <strong class="draft-indicator">(Unsaved device draft restored)</strong>':'')+'</p>'+
    '<form id="'+(project?'project-grounding-form':'grounding-form')+'">'+actionsBar+Object.entries(PROJECT_PHASES).map(([phase,label])=>
      '<details'+(phase==='onboarding'?' open':'')+'><summary>'+esc(label)+'</summary>'+
      PROJECT_HEADINGS.filter(([p])=>p===phase).map(([,key,title])=>
        '<label>'+esc(projectHeadingNumber(key)+'. '+title)+
        (linkKeys.has(key)?
          '<textarea name="ground-'+key+'" rows="1" class="compact-textarea" maxlength="12000" placeholder="UNKNOWN — optional URL or reference">'+esc(values[key]||'')+'</textarea>':
          '<textarea name="ground-'+key+'" rows="3" maxlength="12000" placeholder="UNKNOWN — optional notes and source links">'+esc(values[key]||'')+'</textarea>')+
        '</label>').join('')+'</details>').join('')+archiveView+
    actionsBar+
    '<p class="small">'+(project?'Saved versions belong to this project. Existing thread grounding history is preserved separately.':'Saved updates stay in thread history.')+' Public GitHub saves exclude private chat links.</p></form>';
}

