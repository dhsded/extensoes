console.log('Grok Video Processor content script loaded');

let processingState = {
  isUploading: false,
  isGenerating: false,
  videoUrl: null,
  imageData: null,
  imageName: null,
  imageIndex: 0,
  usePrompts: false,
  customPrompt: '',
  firstVideoGenerated: false
};

document.addEventListener('grokProcessorReady', async (event) => {
  console.log('Processor ready event received');
  processingState.imageData = event.detail.imageDataUrl;
  processingState.imageName = event.detail.imageName;
  processingState.imageIndex = event.detail.index;
  processingState.usePrompts = event.detail.usePrompts || false;
  processingState.customPrompt = event.detail.prompt || '';
  processingState.firstVideoGenerated = false;
  
  console.log('🎯 Processing mode:', processingState.usePrompts ? 'WITH PROMPTS' : 'WITHOUT PROMPTS');
  if (processingState.usePrompts) {
    console.log('📝 Custom prompt:', processingState.customPrompt);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1500));
  await startUploadProcess();
});

async function startUploadProcess() {
  try {
    console.log('Starting upload process...');
    
    updateStatus('uploading', 'Procurando botão de anexo...');
    
    const attachButton = await findAttachButton();
    
    if (!attachButton) {
      console.error('Attach button not found');
      notifyError('Botão de anexo não encontrado');
      return;
    }
    
    console.log('Attach button found, clicking...');
    attachButton.click();
    
    // Tentar selecionar o item "Carregar um arquivo"/"Upload a file" do menu
    const uploadItem = await findUploadMenuItem();
    if (uploadItem) {
      try { uploadItem.focus(); uploadItem.click(); } catch { uploadItem.click(); }
    } else {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    const fileInput = await findFileInput();
    
    if (!fileInput) {
      console.error('File input not found');
      notifyError('Campo de upload não encontrado');
      return;
    }
    
    console.log('File input found, uploading image...');
    await uploadImage(fileInput);
    
    // Aguardar 2s e seguir com prompt antes da primeira geração, se configurado
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (processingState.usePrompts && processingState.customPrompt) {
      await insertPromptAndGenerate();
    } else {
      updateStatus('generating', 'Aguardando geração do vídeo...');
      await waitForVideoGeneration();
    }
    
  } catch (error) {
    console.error('Error in upload process:', error);
    notifyError(error.message);
  }
}

async function findUploadMenuItem() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const items = document.querySelectorAll('div[role="menuitem"], button[role="menuitem"], a[role="menuitem"], li[role="menuitem"], [data-radix-collection-item]');
    for (const el of items) {
      const txt = (el.innerText || el.textContent || '').toLowerCase();
      if (txt.includes('carregar um arquivo') || txt.includes('upload a file')) {
        return el;
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

async function findAttachButton() {
  const selectors = [
    'button[aria-label*="attach" i]',
    'button[aria-label*="anexar" i]',
    'button[title*="attach" i]',
    'button:has(svg path[d*="M10 9V15"])',
    'button:has(svg path[d*="M21 15v4"])',
    '[data-testid*="attach"]',
    'button.attach',
    'button[class*="attach" i]'
  ];
  
  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button) return button;
  }
  
  const buttons = document.querySelectorAll('button');
  for (const button of buttons) {
    const svg = button.querySelector('svg');
    if (svg) {
      const paths = svg.querySelectorAll('path');
      for (const path of paths) {
        const d = path.getAttribute('d');
        if (d && (d.includes('M10 9V15') || d.includes('M21 15v4') || d.includes('M21 15'))) {
          return button;
        }
      }
    }
  }
  
  return null;
}

async function findFileInput() {
  let maxAttempts = 10;
  
  while (maxAttempts > 0) {
    const inputs = document.querySelectorAll('input[type="file"]');
    for (const input of inputs) {
      if (input.accept && input.accept.includes('image')) {
        return input;
      }
    }
    
    const anyFileInput = document.querySelector('input[type="file"]');
    if (anyFileInput) return anyFileInput;
    
    await new Promise(resolve => setTimeout(resolve, 300));
    maxAttempts--;
  }
  
  return null;
}

async function uploadImage(fileInput) {
  return new Promise((resolve, reject) => {
    try {
      fetch(processingState.imageData)
        .then(res => res.blob())
        .then(blob => {
          const file = new File([blob], processingState.imageName, { type: blob.type });
          
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          
          const event = new Event('change', { bubbles: true });
          fileInput.dispatchEvent(event);
          
          console.log('Image uploaded successfully');
          processingState.isUploading = true;
          
          setTimeout(resolve, 1000);
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function waitForVideoGeneration(isSecondGeneration = false) {
  console.log(`Waiting for video generation... (${isSecondGeneration ? 'SECOND' : 'FIRST'})`);
  processingState.isGenerating = true;
  
  const maxWaitTime = 300000;
  const startTime = Date.now();
  const checkInterval = 2000;
  let videoCheckTimeout = null;
  
  const checkForVideo = async () => {
    if (Date.now() - startTime > maxWaitTime) {
      notifyError('Tempo limite excedido aguardando geração do vídeo');
      return;
    }
    
    // Se estiver procurando o segundo vídeo, ignorar o URL do primeiro
    const ignoreUrl = isSecondGeneration ? processingState.firstVideoUrl : null;
    const videoUrl = await findGeneratedVideo(ignoreUrl);
    
    if (videoUrl) {
      console.log('Video found:', videoUrl);
      
      // Limpar timeout para evitar múltiplas chamadas
      if (videoCheckTimeout) {
        clearTimeout(videoCheckTimeout);
        videoCheckTimeout = null;
      }
      
      if (processingState.usePrompts && !processingState.firstVideoGenerated && !isSecondGeneration) {
        console.log('✏️ First video generated, saving URL and inserting custom prompt...');
        processingState.firstVideoUrl = videoUrl; // Salvar URL do primeiro vídeo
        processingState.firstVideoGenerated = true;
        await insertPromptAndRegenerate();
      } else {
        if (!isSecondGeneration) {
          processingState.firstVideoUrl = processingState.firstVideoUrl || videoUrl;
          await openMenuUpscaleAndDownload(videoUrl);
        } else {
          console.log('⬇️ Downloading final video...');
          processingState.videoUrl = videoUrl;
          await downloadVideo(videoUrl);
        }
      }
    } else {
      videoCheckTimeout = setTimeout(checkForVideo, checkInterval);
    }
  };
  
  checkForVideo();
}

async function insertPromptAndRegenerate() {
  try {
    console.log('📝 Inserting custom prompt:', processingState.customPrompt);
    updateStatus('prompting', 'Inserindo prompt customizado...');
    await new Promise(resolve => setTimeout(resolve, 1200));
    let promptTextarea = document.querySelector('textarea[aria-label*="Faça um vídeo" i], textarea[aria-label="Make a video"]');
    if (!promptTextarea) {
      promptTextarea = document.querySelector('textarea.w-full, [role="textbox"], div[contenteditable="true"]');
    }
    if (!promptTextarea) {
      notifyError('Campo de prompt não encontrado');
      return;
    }
    promptTextarea.focus();
    if (promptTextarea.getAttribute && promptTextarea.getAttribute('contenteditable') === 'true') {
      promptTextarea.textContent = processingState.customPrompt;
      promptTextarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
      promptTextarea.value = processingState.customPrompt;
      promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      promptTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    const makeVideoButton = await findMakeVideoButton();
    if (makeVideoButton) {
      try {
        makeVideoButton.focus();
        makeVideoButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        makeVideoButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        makeVideoButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        makeVideoButton.click();
      } catch { makeVideoButton.click(); }
    } else {
      promptTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      promptTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
    updateStatus('generating', 'Aguardando nova geração do vídeo...');
    const secondUrl = await waitForNewVideo(processingState.firstVideoUrl);
    if (!secondUrl) {
      notifyError('Vídeo não gerado');
      return;
    }
    processingState.secondVideoUrl = secondUrl;
    await openMenuUpscaleAndDownload(secondUrl);
    
  } catch (error) {
    console.error('Error inserting prompt:', error);
    notifyError('Erro ao inserir prompt');
  }
}

async function insertPromptAndGenerate() {
  try {
    console.log('📝 Inserting custom prompt (pre-generation):', processingState.customPrompt);
    updateStatus('prompting', 'Inserindo prompt customizado...');
    await new Promise(resolve => setTimeout(resolve, 1200));
    const inserted = await insertPromptOnly(processingState.customPrompt);
    if (!inserted) { notifyError('Campo de prompt não encontrado'); return; }
    const makeVideoButton = await findMakeVideoButton();
    if (makeVideoButton) {
      try {
        makeVideoButton.focus();
        makeVideoButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        makeVideoButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        makeVideoButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        makeVideoButton.click();
      } catch { makeVideoButton.click(); }
    } else {
      const field = await findPromptFieldNearMakeVideo();
      if (field && field instanceof HTMLElement) {
        field.focus();
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      } else { notifyError('Botão "Fazer vídeo" não encontrado'); return; }
    }
    updateStatus('generating', 'Aguardando geração do vídeo...');
    const firstUrl = await waitForNewVideo(null);
    if (!firstUrl) { notifyError('Vídeo não gerado'); return; }
    await openMenuUpscaleAndDownload(firstUrl);
  } catch (error) {
    notifyError('Erro ao inserir prompt');
  }
}

async function findPromptFieldNearMakeVideo() {
  try {
    const btn = await findMakeVideoButton();
    if (btn) {
      const form = btn.closest('form');
      if (form) {
        const inForm = form.querySelector('textarea, input[type="text"], div[contenteditable="true"], [role="textbox"]');
        if (inForm) return inForm;
      }
      let ancestor = btn.parentElement;
      for (let i = 0; i < 4 && ancestor; i++) {
        const candidate = ancestor.querySelector('textarea, input[type="text"], div[contenteditable="true"], [role="textbox"]');
        if (candidate) return candidate;
        ancestor = ancestor.parentElement;
      }
    }
    return null;
  } catch { return null; }
}

async function insertPromptOnly(promptText) {
  try {
    await new Promise(r => setTimeout(r, 700));
    let promptField = document.querySelector('textarea[aria-label*="Faça um vídeo" i], textarea[aria-label="Make a video"], div[contenteditable="true"], [role="textbox"]');
    if (!promptField) promptField = await findPromptFieldNearMakeVideo();
    if (!promptField) return false;
    if (promptField instanceof HTMLElement) promptField.focus();
    if (promptField.getAttribute && promptField.getAttribute('contenteditable') === 'true') {
      promptField.textContent = promptText;
      promptField.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
      promptField.value = promptText;
      promptField.dispatchEvent(new Event('input', { bubbles: true }));
      promptField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 500));
    return true;
  } catch { return false; }
}

async function findMakeVideoButton() {
  console.log('🔍 Searching for Make a video button (Play icon)...');
  
  // Procurar botão com SVG de play (ícone ▶️)
  const selectors = [
    'button[aria-label*="Fazer vídeo" i]',
    'button[aria-label*="Make a video" i]',
    '[role="button"][aria-label*="Fazer vídeo" i]',
    '[role="button"][aria-label*="Make a video" i]',
    'button svg.lucide-play',
    'button svg polygon[points*="6 3 20 12"]',
    'button:has(svg.lucide-play)',
    'button:has(svg polygon[points*="6 3 20 12"])'
  ];
  
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        // Se encontrou o SVG, pegar o botão pai
        const button = element.closest('button') || element.parentElement?.closest('button');
        if (button) {
          console.log('✅ Found play button via selector:', selector);
          return button;
        }
      }
    } catch (e) {
      // Continuar tentando
    }
  }
  
  // Fallback: procurar por botão próximo ao textarea do prompt
  const promptTextarea = document.querySelector('textarea[aria-label="Make a video"], textarea[aria-label*="Faça um vídeo" i]');
  if (promptTextarea) {
    const parent = promptTextarea.closest('div');
    if (parent) {
      const playButton = parent.querySelector('button svg polygon[points*="6 3"]')?.closest('button');
      if (playButton) {
        console.log('✅ Found play button near textarea');
        return playButton;
      }
    }
  }
  
  // Buscar manualmente em todos os botões com SVG
  const allButtons = document.querySelectorAll('button');
  for (const button of allButtons) {
    const svg = button.querySelector('svg');
    if (svg) {
      const polygon = svg.querySelector('polygon');
      if (polygon && polygon.getAttribute('points')?.includes('6 3 20 12')) {
        console.log('✅ Found play button by manual search');
        return button;
      }
    }
  }
  try {
    const spans = document.querySelectorAll('span');
    for (const s of spans) {
      const txt = (s.innerText || s.textContent || '').trim().toLowerCase();
      if (txt.includes('fazer vídeo') || txt.includes('fazer video') || txt.includes('make a video')) {
        const clickable = s.closest('button') || s.closest('[role="button"]');
        if (clickable) return clickable;
      }
    }
  } catch {}
  
  console.error('❌ Make a video button (play icon) not found');
  console.log('Available SVG buttons:', 
    Array.from(allButtons)
      .filter(b => b.querySelector('svg'))
      .map(b => b.querySelector('svg')?.classList.toString())
      .slice(0, 10)
  );
  
  return null;
}

async function findGeneratedVideo(ignoreUrl = null) {
  const videoElements = document.querySelectorAll('video');
  
  for (const video of videoElements) {
    if (video.src && video.src.startsWith('blob:')) {
      // Se deve ignorar uma URL específica (primeiro vídeo), pular
      if (ignoreUrl && video.src === ignoreUrl) {
        console.log('⏭️ Skipping first video URL:', ignoreUrl);
        continue;
      }
      return video.src;
    }
    if (video.src && video.src.includes('.mp4')) {
      if (ignoreUrl && video.src === ignoreUrl) {
        console.log('⏭️ Skipping first video URL:', ignoreUrl);
        continue;
      }
      return video.src;
    }
  }
  
  const sources = document.querySelectorAll('source[type="video/mp4"]');
  for (const source of sources) {
    if (source.src) {
      if (ignoreUrl && source.src === ignoreUrl) continue;
      return source.src;
    }
  }
  
  const links = document.querySelectorAll('a[href*=".mp4"], a[download]');
  for (const link of links) {
    if (link.href && link.href.includes('.mp4')) {
      if (ignoreUrl && link.href === ignoreUrl) continue;
      return link.href;
    }
  }
  
  return null;
}

async function downloadVideo(videoUrl) {
  try {
    updateStatus('downloading', 'Baixando vídeo...');
    console.log('Downloading video from:', videoUrl);
    
    if (videoUrl.startsWith('blob:')) {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      const base = (processingState.imageName || 'video').replace(/\.[^.]+$/, '');
      a.download = `${base}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      notifySuccess();
    } else {
      // Para URLs normais, enviar ao background fazer o download
      // Background vai chamar handleProcessingComplete automaticamente
      console.log('Sending videoDownloadReady to background');
      chrome.runtime.sendMessage({
        action: 'videoDownloadReady',
        videoUrl: videoUrl,
        index: processingState.imageIndex
      });
      // NÃO chamar notifySuccess aqui - background vai fazer o loop
    }
  } catch (error) {
    console.error('Error downloading video:', error);
    notifyError('Erro ao baixar vídeo');
  }
}

function updateStatus(status, statusText) {
  chrome.runtime.sendMessage({
    action: 'updateStatus',
    status: status,
    statusText: statusText
  });
}

function notifySuccess() {
  chrome.runtime.sendMessage({
    action: 'processingComplete',
    success: true
  }).catch(() => {});
}

function notifyError(errorMessage) {
  console.error('Processing error:', errorMessage);
  chrome.runtime.sendMessage({
    action: 'processingComplete',
    success: false,
    error: errorMessage
  }).catch(() => {});
}

// Listener para mensagens do background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showSuccessMessage') {
    showSuccessMessage(message.totalVideos, message.totalImages);
    sendResponse({ success: true });
  }
  return true;
});

function showSuccessMessage(totalVideos, totalImages) {
  console.log('🎉 Showing success message!');
  
  // Criar overlay de sucesso
  const overlay = document.createElement('div');
  overlay.id = 'grok-processor-success';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    animation: fadeIn 0.5s ease-out;
  `;
  
  const successCard = document.createElement('div');
  successCard.style.cssText = `
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
    padding: 40px 60px;
    border-radius: 20px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.5s ease-out;
    max-width: 500px;
  `;
  
  successCard.innerHTML = `
    <div style="font-size: 80px; margin-bottom: 20px; animation: bounce 1s infinite;">🎉</div>
    <h1 style="font-size: 32px; margin-bottom: 15px; font-weight: bold;">Processamento Concluído!</h1>
    <p style="font-size: 18px; margin-bottom: 25px; opacity: 0.95;">
      Todos os vídeos foram gerados e baixados com sucesso!
    </p>
    <div style="display: flex; justify-content: center; gap: 30px; margin-bottom: 25px;">
      <div style="background: rgba(255,255,255,0.2); padding: 15px 25px; border-radius: 10px;">
        <div style="font-size: 28px; font-weight: bold;">${totalVideos}</div>
        <div style="font-size: 14px; opacity: 0.9;">Vídeos Gerados</div>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 15px 25px; border-radius: 10px;">
        <div style="font-size: 28px; font-weight: bold;">${totalImages}</div>
        <div style="font-size: 14px; opacity: 0.9;">Imagens Processadas</div>
      </div>
    </div>
    <p style="font-size: 14px; opacity: 0.8;">
      ✅ Você pode fechar esta aba
    </p>
  `;
  
  // Adicionar animações
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from { 
        opacity: 0;
        transform: translateY(30px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }
    @keyframes bounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
  `;
  document.head.appendChild(style);
  
  overlay.appendChild(successCard);
  document.body.appendChild(overlay);
  
  // Fechar ao clicar
  overlay.addEventListener('click', () => {
    overlay.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => overlay.remove(), 300);
  });
}

if (window.imageToUpload) {
  processingState.imageData = window.imageToUpload;
  processingState.imageName = window.imageName || 'image.jpg';
  processingState.imageIndex = window.imageIndex || 0;
  setTimeout(() => startUploadProcess(), 2000);
}
async function waitForNewVideo(ignoreUrl) {
  const maxWaitTime = 300000;
  const start = Date.now();
  while (Date.now() - start < maxWaitTime) {
    const url = await findGeneratedVideo(ignoreUrl);
    if (url && url !== ignoreUrl) return url;
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

async function findEllipsisButtonForVideo(videoUrl) {
  const videos = document.querySelectorAll('video');
  let target = null;
  for (const v of videos) {
    if (!videoUrl || v.src === videoUrl) { target = v; break; }
  }
  if (!target) return null;
  let container = target.closest('article, div');
  let depth = 0;
  while (container && depth < 6) {
    const btns = container.querySelectorAll('button[aria-haspopup="menu"], button[id^="radix-"]');
    for (const btn of btns) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const svg = btn.querySelector('svg');
      const match = aria.includes('mais opções') || aria.includes('more options') || (svg && (svg.classList.contains('lucide-ellipsis') || svg.classList.contains('lucide-more-horizontal') || svg.classList.contains('lucide-more-vertical')));
      if (match) return btn;
    }
    container = container.parentElement;
    depth++;
  }
  return null;
}

async function waitForUpscaleMenuItem() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const menus = document.querySelectorAll('[role="menu"]');
    for (const menu of menus) {
      const items = menu.querySelectorAll('div[role="menuitem"], li[role="menuitem"], button[role="menuitem"], a[role="menuitem"], [data-radix-collection-item], div, span');
      for (const el of items) {
        const txt = (el.innerText || el.textContent || '').toLowerCase();
        if (
          txt.includes('upscale') ||
          txt.includes('upscale vídeo') ||
          txt.includes('upscale video') ||
          txt.includes('aprimorar') ||
          txt.includes('melhorar qualidade') ||
          txt.includes('melhorar vídeo')
        ) {
          const clickable = el.closest('[role="menuitem"], button, a, div') || el;
          const rect = (clickable instanceof HTMLElement) ? clickable.getBoundingClientRect() : { width: 1, height: 1 };
          if (rect.width > 0 && rect.height > 0) return clickable;
        }
      }
    }
    const svgs = document.querySelectorAll('svg[class*="lucide-expand"]');
    for (const s of svgs) {
      const clickable = s.closest('[role="menuitem"], button, a, div');
      if (clickable) return clickable;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

async function openMenuUpscaleAndDownload(previousUrl) {
  updateStatus('upscaling', 'Abrindo menu e selecionando "Upscale vídeo"...');
  const ellipsisBtn = await findEllipsisButtonForVideo(previousUrl);
  if (!ellipsisBtn) return;
  try {
    ellipsisBtn.focus();
    ellipsisBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    ellipsisBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    ellipsisBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    ellipsisBtn.click();
  } catch { ellipsisBtn.click(); }
  // aguardar o menu abrir visivelmente
  let tries = 0;
  while (tries < 10) {
    const expanded = ellipsisBtn.getAttribute('aria-expanded');
    const menu = document.querySelector('[role="menu"]');
    if ((expanded && expanded.toString() === 'true') || menu) break;
    await new Promise(r => setTimeout(r, 200));
    tries++;
  }
  let upscaleItem = await waitForUpscaleMenuItem();
  if (!upscaleItem) {
    await new Promise(r => setTimeout(r, 400));
    ellipsisBtn.click();
    // aguardar novamente o menu
    tries = 0;
    while (tries < 10) {
      const expanded = ellipsisBtn.getAttribute('aria-expanded');
      const menu = document.querySelector('[role="menu"]');
      if ((expanded && expanded.toString() === 'true') || menu) break;
      await new Promise(r => setTimeout(r, 200));
      tries++;
    }
    upscaleItem = await waitForUpscaleMenuItem();
  }
  if (!upscaleItem) return;
  try {
    upscaleItem.focus();
    upscaleItem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    upscaleItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    upscaleItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    upscaleItem.click();
  } catch { upscaleItem.click(); }
  await new Promise(r => setTimeout(r, 15000));
  updateStatus('generating', 'Aguardando vídeo upscalado...');
  const upscaledUrl = await waitForNewVideo(previousUrl);
  if (upscaledUrl) {
    processingState.videoUrl = upscaledUrl;
    await downloadVideo(upscaledUrl);
  }
}
