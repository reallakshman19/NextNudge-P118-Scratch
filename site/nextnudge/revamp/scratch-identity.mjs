// P118: scratch-only browser identity. All generated Owner issue links must use this repo.
export const SCRATCH_REPO='reallakshman19/NextNudge-P118-Scratch';
export function assertScratchRepo(repo) {
  if(repo!==SCRATCH_REPO)throw Error('SCRATCH_REPOSITORY_REQUIRED: '+String(repo));
  return repo;
}
