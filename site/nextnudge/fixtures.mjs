import {id, now, safeURL} from './identity.mjs';
export const HEADINGS = [
  ['onboarding','1','Inputs'],
  ['onboarding','1a','GitHub issue'],
  ['onboarding','1b','Pull request'],
  ['onboarding','1c','Governing parent issues'],
  ['onboarding','1d','Roadmap issue / document'],
  ['onboarding','1e','Owner intent and discussions'],
  ['onboarding','1f','What I understand — my task'],
  ['onboarding','2','Task specification'],
  ['onboarding','3','Golden fixtures'],
  ['onboarding','4','Benchmarks'],
  ['onboarding','5','Test criteria'],
  ['midcycle1','6','Reconciliation against 1f'],
  ['midcycle1','6a','Known issues'],
  ['midcycle1','6b','Pending items'],
  ['midcycle1','6c','What next — my catchup plan'],
  ['midcycle2','7','Reconciliation against 1f, then 1a'],
  ['midcycle2','7a','Known issues'],
  ['midcycle2','7b','Pending items'],
  ['midcycle2','7c','What next — my recovery plan'],
  ['exit','8','Reconciliation against 1f, 1a, 1d, then 1e'],
  ['exit','8a','Known issues'],
  ['exit','8b','Pending items'],
  ['exit','8c','Lessons learnt'],
  ['improvements','9','High-ROI improvements — successor writes'],
  ['improvements','10','Future improvements — successor appends']
];
export const PHASES = {
  onboarding:'On boarding',midcycle1:'Midcycle 1',midcycle2:'Midcycle 2',
  exit:'Exit',improvements:'Successor improvements'
};
// The v2 Archive continues to use all original headings and unchanged keys.
 // Current project Grounding Fixtures hide retired Midcycle fields; their old values
 // remain valid historical data. Master Log numbers are display aliases, not a
 // destructive remapping of old 8-series data onto the retired 6-series keys.
export const PROJECT_HEADINGS = HEADINGS.filter(([phase])=>phase!=='midcycle1'&&phase!=='midcycle2');
export const RETIRED_MIDCYCLE = HEADINGS.filter(([phase])=>phase==='midcycle1'||phase==='midcycle2');
export const RETIRED_MIDCYCLE_KEYS = new Set(RETIRED_MIDCYCLE.map(([,key])=>key));
export const PROJECT_PHASES = {onboarding:'On boarding',exit:'Master Log',improvements:'Successor improvements'};
export const projectHeadingNumber = key=>({8:'6','8a':'6a','8b':'6b','8c':'6c',9:'7',10:'8'})[key]||key;
export const appendOnly = key => ['1e','10'].includes(key);
export const emptyFixtures = () => Object.fromEntries(HEADINGS.map(([,key]) => [key,[]]));
export function fixtureChange(db, run, key, values, rowId, approvalNote = '') {
  if (!Object.hasOwn(run.fixtures,key)) throw Error('Unknown fixture heading.');
  if (!values.text?.trim() || !safeURL(values.url || '')) {
    throw Error('Enter an item and a valid http(s) link, or leave the link blank.');
  }
  const row = run.fixtures[key].find(r => r.id === rowId);
  if (row && appendOnly(key)) throw Error('This heading is append-only. Add a new item.');
  if (row && key === '1d' && !approvalNote.trim()) {
    throw Error('Record the Owner-approved update basis, or append a new roadmap item.');
  }
  const before = row ? structuredClone(row) : null;
  const next = {
    id:row?.id || id('GF',db), text:values.text.trim(), url:values.url || '',
    status:values.status || 'UNKNOWN', at:now(), by:'Owner',
    ...(row?.source ? {source:row.source} : {})
  };
  if (row) Object.assign(row,next); else run.fixtures[key].push(next);
  return {before,after:structuredClone(next),approvalNote};
}
export function pullFixtures(db, target, key, sourceId) {
  const source = db.runs.find(r => r.id === sourceId && !r.deleted);
  if (!source || source === target || source.createdAt > target.createdAt) throw Error('Choose a different earlier run.');
  const rows = source.fixtures[key].filter(r => !r.deleted);
  if (!rows.length) throw Error('That source heading has no current items.');
  const copied=[];
  for (const row of rows) {
    const duplicate=target.fixtures[key].some(r => !r.deleted &&
      r.source?.run===source.id && r.source?.row===row.id && r.source?.rowAt===row.at);
    if (duplicate) continue;
    const next={...structuredClone(row),id:id('GF',db),at:now(),status:'NEEDS_REVIEW',
      source:{project:source.projectId,run:source.id,heading:key,row:row.id,
        rowAt:row.at,revision:db.revision,pulledAt:now()}};
    target.fixtures[key].push(next);
    copied.push(next);
  }
  return copied;
}
