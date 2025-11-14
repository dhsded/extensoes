let diFrame=null, diOpen=false;

function waitFor(pred,{timeout=30000,interval=300}={}){
  const start=Date.now();
  return new Promise(res=>{
    const t=setInterval(()=>{
      try{
        if(pred()){ clearInterval(t); res(true); }
        else if(Date.now()-start>timeout){ clearInterval(t); res(false); }
      }catch(e){ clearInterval(t); res(false); }
    },interval);
  });
}

function injectSidebar(){
  if(diFrame) return;
  diFrame=document.createElement('iframe');
  diFrame.src=chrome.runtime.getURL('sidebar.html');
  Object.assign(diFrame.style,{position:'fixed',top:'0',right:'0',width:'380px',height:'100vh',zIndex:'999999',border:'0',background:'transparent'});
  document.documentElement.appendChild(diFrame);
  window.addEventListener('message',ev=>{ if(ev.data?.type==='DI_CLOSE') toggleSidebar(false); });
  diOpen=true;
}
function removeSidebar(){ if(diFrame){diFrame.remove(); diFrame=null;} diOpen=false; }
function toggleSidebar(force){ const open = typeof force==='boolean'? force : !diOpen; if(open) injectSidebar(); else removeSidebar(); }

function postToPanel(type,payload){ if(diFrame?.contentWindow) diFrame.contentWindow.postMessage({type, ...payload}, '*'); }

async function uploadImageToSite(dataUrl){
  try{
    const blob=await fetch(dataUrl).then(r=>r.blob());
    const file=new File([blob],'image.png',{type:blob.type||'image/png'});
    const clickables=[...document.querySelectorAll('button,[role="button"],.btn,.button')]
      .filter(el=>/upload|arquivo|file|carregar|enviar|imagem|image/i.test(el.textContent||''));
    clickables[0]?.click();
    const ok=await waitFor(()=>document.querySelector('input[type="file"]'),{timeout:8000});
    const input=document.querySelector('input[type="file"]');
    if(!ok||!input) return false;
    const dt=new DataTransfer(); dt.items.add(file); input.files=dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }catch(e){ console.error('uploadImageToSite',e); return false; }
}

async function waitPreview(){ return await waitFor(()=>{
  const img=document.querySelector('img, .uploadImgShow img, .preview img'); return !!img && img.complete;
},{timeout:20000,interval:400}); }

async function insertPrompt(prompt){ return true; } // opcional por enquanto

async function clickGenerate(){
  const labels=['Generate','Generate video','Gerar','Gerar vídeo','Create','Start'];
  let btn=[...document.querySelectorAll('button,[role="button"]')].find(el=>labels.some(t=>(el.textContent||'').toLowerCase().includes(t.toLowerCase())));
  if(!btn) btn=document.querySelector('div.generateVideo, button.generateVideo');
  if(!btn) return false;
  btn.click();
  chrome.runtime.sendMessage({action:'incGenerated'});
  await waitFor(()=>!!document.querySelector('.loading,.spinner,[aria-busy="true"]'),{timeout:5000});
  return true;
}

async function processItem(item, config){
  const t0 = performance.now();
  const push = (status)=>postToPanel('DI_UPDATE_ITEM',{id:item.id,status});
  push('processando');
  const up=await uploadImageToSite(item.dataUrl); if(!up){push('erro'); chrome.runtime.sendMessage({action:'imageDone',success:false,elapsedMs:Math.round(performance.now()-t0)}); return;}
  const okPrev=await waitPreview(); if(!okPrev){push('erro'); chrome.runtime.sendMessage({action:'imageDone',success:false,elapsedMs:Math.round(performance.now()-t0)}); return;}
  await insertPrompt(item.prompt||'');
  const gen=await clickGenerate(); if(!gen){push('erro'); chrome.runtime.sendMessage({action:'imageDone',success:false,elapsedMs:Math.round(performance.now()-t0)}); return;}
  push('concluida');
  await new Promise(r=>setTimeout(r, Math.max(500,(config?.waitBetween||12000))));
  chrome.runtime.sendMessage({action:'imageDone',success:true,elapsedMs:Math.round(performance.now()-t0)});
}

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.action==='toggleSidebar'){ toggleSidebar(); sendResponse({ok:true}); return true; }
  if(msg?.action==='processImage'){ processItem(msg.item,msg.config); sendResponse({ok:true}); return true; }
  if(msg?.action==='queueComplete'){
    sendResponse({ok:true}); return true;
  }
});
