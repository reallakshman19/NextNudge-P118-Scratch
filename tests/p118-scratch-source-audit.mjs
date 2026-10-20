import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),required=[
  'site/nextnudge/index.html','site/nextnudge/fixtures.mjs',
  'site/nextnudge/revamp/app.mjs','site/nextnudge/revamp/save.mjs',
  'site/nextnudge/revamp/project-store.mjs','site/nextnudge/revamp/transport.mjs',
  'site/nextnudge/revamp/transport-request.mjs',
  'scripts/nextnudge_apply.mjs','scripts/nextnudge_project_apply.mjs',
  'scripts/nextnudge_thread_apply.mjs','scripts/nextnudge_action_apply.mjs',
  'scripts/nextnudge_project_guard.mjs','scripts/nextnudge_scratch_guard.mjs'];
const content=p=>fs.readFileSync(path.join(root,p),'utf8');
test('pinned browser import closure remains resolvable',()=>{
  let total=0;
  function scan(dir){
    for(const ent of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
      const p=path.posix.join(dir,ent.name);
      if(ent.isDirectory())scan(p);
      else if(p.endsWith('.mjs')){
        const src=content(p);total++;
        for(const m of src.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+\.mjs)['"]/g)){
          const dep=path.resolve(path.dirname(path.join(root,p)),m[1]);
          assert.ok(fs.existsSync(dep),p+' requires '+m[1]);
        }
      }
    }
  }
  scan('site/nextnudge/revamp');scan('scripts');
  assert.ok(total>=25);
});
test('no active browser, action or project target points to production',()=>{
  for(const p of required){
    assert.ok(fs.existsSync(path.join(root,p)),p);
    const src=content(p);
    assert.ok(!src.includes('https://api.github.com/repos/reallakshman19/CoordinatorLandingpage'),p);
    assert.ok(!src.includes('https://github.com/reallakshman19/CoordinatorLandingpage/issues/new'),p);
  }
  assert.match(content('site/nextnudge/revamp/save.mjs'),/export const REPO='reallakshman19\/NextNudge-P118-Scratch'/);
  assert.match(content('site/nextnudge/revamp/transport.mjs'),/assertScratchRepo\(REPO\)/);
  for(const p of required.filter(s=>/^scripts\/nextnudge_(?:apply|thread_apply|project_apply|action_apply)\.mjs$/.test(s))){
    assert.match(content(p),/assertScratchApi\(/,p);
    assert.match(content(p),/assertScratchRun\(process\.env\.GITHUB_REPOSITORY,event\.repository\?\.full_name\)/,p);
  }
});
test('scratch public-only data files and Owner-only writer boundary',()=>{
  for(const [dir,pattern] of [
    ['site/nextnudge-data/projects',/^NP-\\d{8}-\\d{6}-[a-f0-9]{4}\\.json$/],
    ['site/nextnudge-data/threads',/^NN-\\d{8}-\\d{6}-[a-f0-9]{4}\\.md$/]]){
    for(const name of fs.readdirSync(path.join(root,dir)))
      assert.ok(name==='.gitkeep'||pattern.test(name),dir+'/'+name);
  }
  const workflow=content('.github/workflows/nextnudge-save.yml');
  assert.match(workflow,/github\\.repository == 'reallakshman19\\/NextNudge-P118-Scratch'/);
  assert.match(workflow,/github\\.event\\.issue\\.user\\.login == github\\.repository_owner/);
  assert.match(workflow,/contains\\(github\\.event\\.issue\\.labels\\.\\*\\.name, 'nextnudge-save'\\)/);
  assert.match(workflow,/contents: write/);
  assert.match(workflow,/issues: write/);
  assert.match(workflow,/persist-credentials: false/);
});
