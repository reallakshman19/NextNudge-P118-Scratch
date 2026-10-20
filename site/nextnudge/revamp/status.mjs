// A return answers only the explicit sent move that precedes it.
export function pendingMoves(thread){
  return thread.moves.filter((move,index)=>move.delivery==='sent'&&move.kind!=='reply'&&
    !thread.moves.slice(index+1).some(reply=>reply.kind==='reply'&&reply.answers===move.id));
}
export function answered(thread,move){
  const index=thread.moves.indexOf(move);
  return index>=0&&thread.moves.slice(index+1).some(reply=>reply.kind==='reply'&&reply.answers===move.id);
}
