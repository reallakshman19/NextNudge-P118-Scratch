import {activeAgent,activeIntent,currentState} from './thread.mjs';
import {PROJECT_HEADINGS} from '../fixtures.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function packet(id,kind,body,i,options={}) {
  const common=['[Owner · NextNudge '+id+']','Owner intent: '+i.goal,
    'Owner done-when: '+(i.doneWhen.join(' | ')||'UNKNOWN — ask Owner'),
    'In scope: '+i.inScope,'Out of scope: '+i.outScope,
    'Uncertainty: report UNKNOWN; never substitute an assumption.',
    'COMPLETE describes this bounded task, not Owner-outcome acceptance.'];
  const prefix=kind==='task'?'Purpose:\n'+i.goal+'\nOne bounded task:\n'+body+
    '\nAuthoritative inputs:\n'+(options.inputs||'UNKNOWN')+'\nBoundaries:\n'+(options.boundaries??i.inScope)+'\nSuccess criteria:\n'+(options.success||i.doneWhen.join(' | ')||'UNKNOWN')+
    '\nUncertainty handling:\nState missing facts and blocked actions.\nEvidence and continuation:\nReturn artifacts, limits and next feasible action.':
    kind==='ground'?'Restate the Owner intent and done-when in your own words. State your first step and unknowns.\n'+body:
    kind==='correction'?'Quote the incorrect claim, identify the input interpretation, give the redo scope.\n'+body:
    kind==='close'?'The Owner outcome checks were verified. Return the final PR/file/comment pointer.\n'+body:body;
  return [...common,prefix,'Start your reply with ACK '+id+'.'].join('\n\n');
}
export function threadsMarkup(threads,{create=true}={}) {
  const rows=Object.values(threads).sort((a,b)=>b.id.localeCompare(a.id));
  return '<h2>Threads</h2><p>One intent, one current move. Drafts stay on this device.</p>'+
    (create?'<form id="new-thread"><label>Intent title <input name="title" required maxlength="120"></label>'+
    '<label>Owner goal, in their words <textarea name="goal" required></textarea></label>'+
    '<label>Agent <input name="agent" placeholder="Agent or UNKNOWN"></label>'+
    '<button type="submit">Create thread</button></form>':'')+
    '<div class="thread-list">'+rows.map(x=>'<button data-open="'+esc(x.id)+'" class="thread-row">'+
      '<strong>'+esc(x.title)+'</strong><span>'+esc(activeAgent(x)||'UNKNOWN')+' · '+esc(currentState(x))+
      (activeIntent(x).hold?' · '+esc(activeIntent(x).hold):'')+'</span></button>').join('')+'</div>'+
    '<div class="archive"><details><summary>v2 Archive · read-only + Convert</summary>'+
    '<p>Original v2 database is retained unchanged. Historical statuses do not prove acceptance.</p>'+
    '<button data-action="archive-list">List v2 runs for conversion</button><div id="archive-runs"></div>'+
    '<p><a href="v2.html" target="_blank" rel="noopener noreferrer">Open original v2 workbench (historical interface)</a></p></details></div>'+
    '<p><button data-action="load-id">Load existing GitHub thread by ID</button> '+
    '<button data-action="import">Import Markdown thread</button></p>';
}

export function projectsMarkup(projects,threads){
  const all=Object.values(projects).sort((a,b)=>a.name.localeCompare(b.name));
  const assigned=new Set(all.flatMap(p=>p.threads.map(row=>row.id)));
  const legacy=Object.fromEntries(Object.entries(threads).filter(([id])=>!assigned.has(id)));
  return '<h2>Projects</h2><p>Select a project to open agent threads or its one shared Grounding Fixtures library.</p>'+
    '<form id="new-project"><label>Project name <input name="name" required maxlength="120"></label>'+
    '<button type="submit">Create project</button></form>'+
    '<div class="thread-list">'+all.map(p=>'<button data-project="'+esc(p.id)+'" class="thread-row">'+
      '<strong>'+esc(p.name)+'</strong><span>'+p.threads.length+' agent threads · '+Object.keys(p.fixtures).length+
      ' grounding headings</span></button>').join('')+'</div>'+
    '<details><summary>Unassigned legacy v3 threads ('+Object.keys(legacy).length+') · preserved</summary>'+
    '<p>No project is inferred from a historical title, URL or agent. Attach explicitly within a project.</p>'+
    threadsMarkup(legacy,{create:false})+'</details>';
}
export function projectMarkup(project,threads,projects={}){
  const pairs=project.threads.map(row=>({row,thread:threads[row.id]}));
  const collisions=new Map(),duplicates=[];
  for(const {row} of pairs){const key=row.agent.toLowerCase();
    if(collisions.has(key))duplicates.push(row.agent);else collisions.set(key,row.id);}
  const linked=new Set(Object.values(project.threads).map(row=>row.id));
  const globallyLinked=new Set(Object.values(projects).flatMap(p=>p.threads.map(row=>row.id)));
  const unassigned=Object.values(threads).filter(t=>!linked.has(t.id)&&!globallyLinked.has(t.id));
  return '<div class="heading"><button data-action="projects">← Projects</button><h2>'+esc(project.name)+'</h2></div>'+
    '<section><h3>Grounding Fixtures</h3><p>One shared library for this project · '+PROJECT_HEADINGS.length+' optional active headings</p>'+
    '<button data-action="project-grounding">Open shared Grounding Fixtures</button></section>'+ 
    '<section><h3>Master Log</h3><p>All available agents\' original Task, Ground, Correction, Reconcile, reply and other records — read-only, with per-item links.</p>'+ 
    '<button data-action="master-log">Open project Master Log</button></section>'+
    (duplicates.length?'<p role="alert"><strong>Legacy conflict:</strong> duplicate agent associations retained: '+esc(duplicates.join(', '))+'. No threads were merged.</p>':'')+
    '<h3>Agent Threads</h3><div class="thread-list">'+pairs.map(({row,thread})=>
      '<button data-open="'+esc(row.id)+'" class="thread-row"><strong>'+esc(row.agent)+(row.legacy?' · legacy':'')+
      '</strong><span>'+esc(thread?.title||'Thread not on this device · load from GitHub')+
      (thread?' · '+esc(currentState(thread)):'')+'</span></button>').join('')+'</div>'+
    '<form id="new-thread"><h3>New agent thread</h3>'+
    '<label>Agent <input name="agent" required maxlength="200"></label>'+
    '<label>Intent title <input name="title" required maxlength="120"></label>'+
    '<label>Owner goal <textarea name="goal" required></textarea></label>'+
    '<button type="submit">Create agent thread</button>'+ 
    '<p id="new-thread-error" role="alert" aria-live="assertive" tabindex="-1"></p></form>'+
    '<details><summary>Attach an existing legacy thread (explicit, no merges)</summary>'+
    '<form id="attach-thread"><label>Unassigned thread <select name="thread">'+unassigned.map(t=>
      '<option value="'+esc(t.id)+'">'+esc(t.title)+' · '+esc(activeAgent(t)||'UNKNOWN')+'</option>').join('')+
    '</select></label><p>A competing historical agent is retained and visibly flagged; no fixtures are merged.</p>'+
    '<button type="submit">Attach selected thread</button></form></details>'+
    '<section><button data-action="project-save" class="primary">Save project to GitHub · Owner review</button> '+
    '<button data-action="project-reload">Compare project with GitHub</button>'+
    '<p>Local changes are device drafts until the Owner-submitted GitHub save returns SAVED and readback is verified. Concurrent changes are rejected.</p></section>';
}
