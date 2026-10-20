export const MODES=['ground','task','correction','reconcile'];
export const TITLES={ground:'Ground',task:'Task',correction:'Correction',reconcile:'Reconcile'};
const captions={ground:'Context & sources',task:'One assignment',correction:'Linked redo',reconcile:'Evidence & decision'};
export function workspaceNav(active='overview'){
  return '<nav class="workspace-tabs" aria-label="Project workspaces">'+
    '<button data-action="thread"'+(active==='overview'?' aria-current="page"':'')+'>Overview</button>'+
    MODES.map(mode=>'<button data-action="workspace-'+mode+'"'+(active===mode?' aria-current="page"':'')+'>'+TITLES[mode]+'<small>'+captions[mode]+'</small></button>').join('')+
    '<button data-action="grounding"'+(active==='fixtures'?' aria-current="page"':'')+'>Grounding Fixtures<small>Reusable library</small></button></nav>';
}
