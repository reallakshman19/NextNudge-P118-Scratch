// P118 scratch: fail closed before every GitHub request in the issue writer.
import {SCRATCH_REPO,assertScratchRepo} from '../site/nextnudge/revamp/scratch-identity.mjs';
const DATA_ROOT='contents/site/nextnudge-data/';
const ALLOWED_DATA=/^(?:threads\/NN-\d{8}-\d{6}-[a-f0-9]{4}\.md|projects\/NP-\d{8}-\d{6}-[a-f0-9]{4}\.json)$/;
export function assertScratchRun(repo,eventRepo) {
  assertScratchRepo(repo);
  if(eventRepo!==undefined&&eventRepo!==SCRATCH_REPO)
    throw Error('SCRATCH_EVENT_REPOSITORY_REQUIRED: '+String(eventRepo));
  return true;
}
export function assertScratchApi(repo,path,opts={}) {
  assertScratchRun(repo);
  if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('..')||path.includes('%')||
    path.includes('\\')||/[\r\n#]/.test(path)||/https?:/i.test(path)||
    !/^[a-zA-Z0-9._/?=&-]+$/.test(path))throw Error('SCRATCH_API_PATH_REJECTED');
  const method=(opts.method||'GET').toUpperCase();
  if(method==='PUT'){
    if(!path.startsWith(DATA_ROOT)||!ALLOWED_DATA.test(path.slice(DATA_ROOT.length)))
      throw Error('SCRATCH_DATA_ONLY: only project and thread writes');
    let body;try{body=JSON.parse(opts.body);}catch{throw Error('SCRATCH_WRITE_BODY_INVALID');}
    if(body?.branch!=='main'||typeof body.content!=='string'||!body.content)
      throw Error('SCRATCH_MAIN_WRITE_REQUIRED');
  }else if(method==='POST'){
    if(!/^issues\/[1-9][0-9]*\/comments$/.test(path))throw Error('SCRATCH_POST_REJECTED');
  }else if(method==='PATCH'){
    if(!/^issues\/[1-9][0-9]*$/.test(path))throw Error('SCRATCH_PATCH_REJECTED');
    let body;try{body=JSON.parse(opts.body);}catch{throw Error('SCRATCH_PATCH_BODY_INVALID');}
    if(body?.state!=='closed'||Object.keys(body).length!==1)throw Error('SCRATCH_CLOSE_ONLY');
  }else if(method!=='GET')throw Error('SCRATCH_METHOD_REJECTED');
  if(method==='GET' && path.startsWith('contents/') &&
    (!path.endsWith('?ref=main')||!path.startsWith(DATA_ROOT)))
    throw Error('SCRATCH_MAIN_DATA_READ_ONLY');
  return 'https://api.github.com/repos/'+SCRATCH_REPO+'/'+path;
}
