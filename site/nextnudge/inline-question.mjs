// Lightweight inline in-page decision form. No blocking browser dialogs.
export function askInline({title,message='',label='',initial='',accept='Continue',danger=false}={}){
  return new Promise(resolve=>{
    const host=document.createElement('section');
    host.setAttribute('role','dialog');
    host.setAttribute('aria-modal','true');
    host.className='nextnudge-inline-question';
    host.style.cssText='position:fixed;inset:10% 15%;z-index:10000;background:Canvas;color:CanvasText;'+
      'border:2px solid currentColor;padding:1rem;overflow:auto;box-shadow:0 0 0 100vmax #0006';
    const h=document.createElement('h3');h.textContent=title||'Confirm action';host.append(h);
    if(message){const p=document.createElement('p');p.textContent=message;host.append(p);}
    const form=document.createElement('form');host.append(form);
    let input=null;
    if(label){
      const l=document.createElement('label');l.textContent=label+' ';
      input=document.createElement('input');input.required=true;input.value=initial;input.maxLength=200;
      l.append(input);form.append(l);
    }
    const ok=document.createElement('button');ok.type='submit';ok.textContent=accept;
    if(danger)ok.className='danger';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
    form.append(ok,' ',cancel);
    const finish=(value)=>{host.remove();resolve(value);};
    form.addEventListener('submit',e=>{e.preventDefault();finish({ok:true,value:input?.value||''});});
    cancel.addEventListener('click',()=>finish({ok:false,value:''}));
    host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish({ok:false,value:''});}});
    document.body.append(host);(input||ok).focus();
  });
}
