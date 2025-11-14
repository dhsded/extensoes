// IndexedDB helper (inline para service worker)
const DB_NAME = 'GrokAutomatorDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let db = null;

async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;

      db.onversionchange = () => {
        db.close();
        db = null;
      };

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

async function saveImageToDB(image) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(image);
    
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function getImageFromDB(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllImagesFromDB() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteImageFromDB(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function clearDB() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// ========================= ESTADO PRINCIPAL ==========================
let processingState = {
  images: [],             // [{ id, name, status }]
  currentIndex: 0,
  isProcessing: false,
  isPaused: false,
  stats: {
    completed: 0,
    failed: 0
  },
  startTime: null,
  lastUpdate: null,
  imageStartTime: null,   // início do processamento da imagem atual
  isStuck: false,
  stuckSince: null,
  pauseEndTime: null,     // para pausa periódica
  downloadedVideoUrls: [] // para evitar vídeos duplicados
};

let processingOptions = {
  pauseEvery: 0,
  pauseDuration: 0,
  usePrompts: false,
  prompts: []
};

let processingTab = null;

// ========================= STORAGE HELPERS ==========================
async function saveState() {
  processingState.lastUpdate = Date.now();
  await chrome.storage.local.set({
    processingState,
    processingOptions
  });
}

async function ensureStateLoaded() {
  if (processingState.images.length > 0 || processingState.isProcessing || processingState.isPaused) {
    return;
  }

  const result = await chrome.storage.local.get(['processingState', 'processingOptions']);
  
  if (result.processingState) {
    processingState = {
      ...processingState,
      ...result.processingState,
      downloadedVideoUrls: result.processingState.downloadedVideoUrls || []
    };
    console.log('✅ State restored from storage');
  }
  
  if (result.processingOptions) {
    processingOptions = result.processingOptions;
    console.log('✅ Processing options restored');
  }
}

// ========================= RELATÓRIO COMPLETO ==========================
async function generateCompleteReport() {
  const allImages = await getAllImagesFromDB();
  
  const rows = allImages.map((img, index) => {
    const status = img.status || 'pending';
    const name = img.name || `Imagem ${index + 1}`;
    return `${index + 1};${name};${status}`;
  });
  
  return [
    'Índice;Nome;Status',
    ...rows
  ].join('\n');
}

// ========================= MENSAGENS RUNTIME ==========================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Message received:', message.action);
  
  if (message.action === 'getState') {
    // Enviar APENAS metadados (sem dataUrl para evitar message too large)
    (async () => {
      try {
        await ensureStateLoaded();
        
        // Retornar apenas metadados - popup buscará dataUrl do IndexedDB
        const lightState = {
          ...processingState,
          images: processingState.images.map(meta => ({
            id: meta.id,
            name: meta.name,
            status: meta.status
          }))
        };
        
        console.log('✅ Sending lightweight state (metadata only)');
        console.log(`📊 State: ${lightState.images.length} images, currentIndex: ${lightState.currentIndex}, processing: ${lightState.isProcessing}`);
        sendResponse({ state: lightState });
      } catch (error) {
        console.error('Error getting state:', error);
        sendResponse({ state: processingState });
      }
    })();
    return true;
  }
  
  if (message.action === 'imagesAdded') {
    // Nova ação leve: apenas notifica que imagens foram adicionadas (já estão no IndexedDB)
    console.log(`📦 ${message.count} imagens adicionadas ao IndexedDB pelo popup`);
    (async () => {
      try {
        await ensureStateLoaded();
        
        // Buscar todas as imagens do IndexedDB para sincronizar metadados
        const allImages = await getAllImagesFromDB();
        
        // Atualizar metadados no state (apenas id, name, status)
        processingState.images = allImages.map(img => ({
          id: img.id,
          name: img.name,
          status: img.status || 'pending'
        }));
        
        await saveState();
        
        console.log(`🔄 State sync: ${processingState.images.length} imagens carregadas do IndexedDB`);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error syncing images from DB:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'addImages') {
    console.log('Adding images to IndexedDB (from popup)...');
    (async () => {
      try {
        await ensureStateLoaded();
        
        for (const img of message.images) {
          // Salvar imagem completa no IndexedDB
          await saveImageToDB({
            id: img.id,
            name: img.name,
            dataUrl: img.dataUrl,
            status: 'pending'
          });
          
          // Adicionar metadados ao state
          processingState.images.push({
            id: img.id,
            name: img.name,
            status: 'pending'
          });
        }
        
        await saveState();
        console.log(`✅ ${message.images.length} images saved to IndexedDB`);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error adding images:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  if (message.action === 'removeImage') {
    console.log('Removing image:', message.id);
    (async () => {
      try {
        await deleteImageFromDB(message.id);
        processingState.images = processingState.images.filter(img => img.id !== message.id);
        await saveState();
        console.log('✅ Image removed');
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error removing image:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'clearAll') {
    console.log('Clearing all images and state');
    (async () => {
      try {
        await clearDB();
        processingState = {
          images: [],
          currentIndex: 0,
          isProcessing: false,
          isPaused: false,
          stats: { completed: 0, failed: 0 },
          startTime: null,
          lastUpdate: null,
          imageStartTime: null,
          isStuck: false,
          stuckSince: null,
          pauseEndTime: null,
          downloadedVideoUrls: []
        };
        await saveState();
        console.log('✅ All cleared');
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error clearing all:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  if (message.action === 'startProcessing') {
    (async () => {
      await ensureStateLoaded();
      console.log('🎬 START PROCESSING RECEIVED!');
      console.log('Images to process:', processingState.images.length);
      
      // Salvar opções de processamento
      if (message.options) {
        processingOptions = message.options;
        console.log('Processing options:', processingOptions);
        console.log('Use prompts:', processingOptions.usePrompts);
        console.log('Prompts array:', processingOptions.prompts);
      }
      
      await startProcessing();
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (message.action === 'pauseProcessing') {
    console.log('Pause processing');
    processingState.isPaused = !processingState.isPaused;
    saveState();
    if (!processingState.isPaused) {
      resumeProcessing();
    }
    sendResponse({ success: true, paused: processingState.isPaused });
    return true;
  }

  if (message.action === 'cancelProcessing') {
    console.log('Cancel processing');
    (async () => {
      await cancelProcessing();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === 'videoDownloadReady') {
    console.log('Video download ready');
    handleVideoDownload(message, sendResponse);
    return true;
  }
  
  if (message.action === 'processingComplete') {
    console.log('Processing complete from content:', {
      success: message.success,
      index: message.index
    });
    handleProcessingComplete(message.success, message.index);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'generateReport') {
    console.log('📋 Generating complete report');
    (async () => {
      try {
        await ensureStateLoaded();
        const report = await generateCompleteReport();
        sendResponse({ success: true, report });
      } catch (error) {
        console.error('Error generating report:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// ========================= PROCESSAMENTO PRINCIPAL ==========================
async function startProcessing() {
  console.log('⚡ startProcessing() called');
  console.log('Number of images:', processingState.images.length);
  
  processingState.isProcessing = true;
  processingState.isPaused = false;
  processingState.currentIndex = 0;
  processingState.stats = { completed: 0, failed: 0 };
  processingState.startTime = Date.now();
  
  console.log('State updated, calling saveState...');
  await saveState();
  
  console.log('Calling processNextImage...');
  processNextImage();
}

async function resumeProcessing() {
  if (!processingState.isProcessing || processingState.isPaused) return;
  processNextImage();
}

let processingTimeout = null;

async function restartCurrentImage() {
  console.log('🔁 restartCurrentImage called');
  
  if (!processingState.isProcessing) {
    console.log('Not processing, ignoring restart');
    return;
  }

  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }

  processingState.isStuck = true;
  processingState.stuckSince = processingState.imageStartTime || Date.now();
  await saveState();

  if (processingTab) {
    try { await chrome.tabs.remove(processingTab); } catch (e) {}
    processingTab = null;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const tab = await chrome.tabs.create({ url: 'https://grok.com/imagine/', active: false });
  processingTab = tab.id;

  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === processingTab && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        try {
          if (processingState.isProcessing && !processingState.isPaused) {
            processNextImage();
          }
        } catch (err) {
          console.error('Error on restartCurrentImage processNextImage:', err);
        }
      }, 2000);
    }
  });
}

async function processNextImage() {
  console.log('🔄 ========== processNextImage START ==========');
  console.log('Current index:', processingState.currentIndex);
  console.log('Is processing:', processingState.isProcessing);
  console.log('Is paused:', processingState.isPaused);
  console.log('Total images:', processingState.images.length);

  await ensureStateLoaded();

  if (!processingState.isProcessing || processingState.isPaused) {
    console.log('⏹️ Processing stopped or paused. Exiting processNextImage.');
    return;
  }
  
  if (processingState.currentIndex >= processingState.images.length) {
    console.log('✅ All images processed!');
    processingState.isProcessing = false;
    await saveState();
    return;
  }

  const imageMeta = processingState.images[processingState.currentIndex];
  console.log('🖼️ Processing image meta:', imageMeta);

  if (!imageMeta) {
    console.log('⚠️ No image meta found, moving to next');
    processingState.currentIndex++;
    await saveState();
    processNextImage();
    return;
  }

  let imageRecord = null;
  try {
    imageRecord = await getImageFromDB(imageMeta.id);
  } catch (error) {
    console.error('Error getting image from DB:', error);
  }

  if (!imageRecord || !imageRecord.dataUrl) {
    console.log('⚠️ No image data in DB for id:', imageMeta.id, 'moving to next');
    imageMeta.status = 'failed';
    processingState.stats.failed++;
    processingState.currentIndex++;
    await saveState();
    processNextImage();
    return;
  }

  console.log('✅ Image data loaded from DB, launching Grok tab...');

  processingState.imageStartTime = Date.now();
  processingState.isStuck = false;
  processingState.stuckSince = null;
  await saveState();

  if (!processingTab) {
    console.log('🌐 Creating new tab for Grok Imagine...');
    const tab = await chrome.tabs.create({ url: 'https://grok.com/imagine/', active: false });
    processingTab = tab.id;
  } else {
    console.log('🔁 Reusing existing processing tab:', processingTab);
  }

  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === processingTab && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      
      console.log('✅ Tab loaded! Injecting script in 2 seconds...');
      
      setTimeout(async () => {
        try {
          console.log('🚀 Sending processImage message to content script');
          const prompt = (processingOptions.usePrompts && Array.isArray(processingOptions.prompts))
            ? processingOptions.prompts[processingState.currentIndex] || ''
            : '';
          
          await chrome.tabs.sendMessage(processingTab, {
            action: 'processImage',
            imageDataUrl: imageRecord.dataUrl,
            imageName: imageMeta.name,
            index: processingState.currentIndex,
            usePrompts: processingOptions.usePrompts,
            prompt
          });
          
          // Watchdog para imagem travada
          if (processingTimeout) clearTimeout(processingTimeout);
          processingTimeout = setTimeout(() => {
            console.log('⏰ Watchdog: image processing took too long, restarting current image');
            restartCurrentImage();
          }, 120000); // 120 segundos
        } catch (err) {
          console.error('Error sending processImage message:', err);
          if (processingTimeout) clearTimeout(processingTimeout);
          handleProcessingComplete(false, processingState.currentIndex);
        }
      }, 2000);
    }
  });
}

function handleProcessingComplete(success, index) {
  console.log('handleProcessingComplete called:', {
    success,
    index,
    currentIndex: processingState.currentIndex
  });

  // Limpar timeout de watchdog
  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }

  // Descobrir qual índice usar: o que veio da mensagem ou o currentIndex
  let idx = (typeof index === 'number' && !Number.isNaN(index))
    ? index
    : processingState.currentIndex;

  // Segurança extra: impedir índices negativos
  if (idx < 0) idx = 0;

  const imageMeta = processingState.images[idx];

  if (!imageMeta) {
    console.warn('⚠️ handleProcessingComplete: imagem inexistente para idx =', idx);
    return;
  }

  // Se essa imagem já foi finalizada, ignorar chamadas duplicadas
  if (imageMeta.status === 'completed' || imageMeta.status === 'failed') {
    console.warn(
      '⚠️ handleProcessingComplete: idx',
      idx,
      'já finalizado com status',
      imageMeta.status,
      '- ignorando conclusão duplicada'
    );
    return;
  }

  // Atualiza status e estatísticas
  if (success) {
    imageMeta.status = 'completed';
    processingState.stats.completed++;
    console.log('✅ Image index', idx, 'completed successfully');
  } else {
    imageMeta.status = 'failed';
    processingState.stats.failed++;
    console.log('❌ Image index', idx, 'failed');
  }

  // Avança o ponteiro do loop apenas até o próximo após este índice
  if (idx >= processingState.currentIndex) {
    processingState.currentIndex = idx + 1;
  }

  // Reset de controle de imagem travada
  processingState.imageStartTime = null;
  processingState.isStuck = false;
  processingState.stuckSince = null;

  saveState().then(() => {
    console.log('➡️ Next index will be:', processingState.currentIndex);
    console.log(
      'Current processing flags - isProcessing:',
      processingState.isProcessing,
      'isPaused:',
      processingState.isPaused
    );

    // Pausa periódica
    if (
      processingOptions.pauseEvery > 0 &&
      processingState.stats.completed > 0 &&
      processingState.stats.completed % processingOptions.pauseEvery === 0
    ) {
      console.log(
        `⏸️ Pausing for ${processingOptions.pauseDuration} seconds after ${processingState.stats.completed} videos`
      );
      processingState.isPaused = true;
      processingState.pauseEndTime = Date.now() + (processingOptions.pauseDuration * 1000);

      saveState().then(() => {
        setTimeout(() => {
          console.log('⏯️ Resuming after periodic pause');
          processingState.isPaused = false;
          processingState.pauseEndTime = null;
          saveState();
          if (processingState.currentIndex < processingState.images.length) {
            processNextImage();
          }
        }, processingOptions.pauseDuration * 1000);
      });

      return;
    }

    if (processingState.isProcessing && !processingState.isPaused) {
      console.log('Calling processNextImage in 1 second...');
      setTimeout(() => {
        console.log('Timeout fired, calling processNextImage now');
        processNextImage();
      }, 1000);
    } else {
      console.log('Not calling processNextImage - stopped or paused');
    }
  });
}

// ========================= DOWNLOAD DO VÍDEO ==========================
async function handleVideoDownload(message, sendResponse) {
  console.log('📥 Handling video download for index:', message.index);
  console.log('Video URL:', message.videoUrl);
  
  // Verificar se já baixamos este vídeo (evita baixar o primeiro vídeo 2x quando usa prompts)
  if (processingState.downloadedVideoUrls.includes(message.videoUrl)) {
    console.log('⚠️ Video URL already downloaded, skipping:', message.videoUrl);
    sendResponse({ success: true, skipped: true });
    return;
  }
  
  try {
    const imgMeta = processingState.images[message.index] || processingState.images[processingState.currentIndex] || null;
    const base = imgMeta && imgMeta.name ? imgMeta.name.replace(/\.[^.]+$/, '') : `video_${message.index + 1}`;
    const filename = `${base}.mp4`;
    
    console.log('💾 Starting download with filename:', filename);
    
    const downloadId = await chrome.downloads.download({
      url: message.videoUrl,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    
    console.log('⬇️ Download started, id:', downloadId);
    
    // Marcar URL como já baixada
    processingState.downloadedVideoUrls.push(message.videoUrl);
    await saveState();
    
    // Aguardar conclusão do download
    const onChangedListener = (delta) => {
      if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
        console.log('✅ Download complete for id:', downloadId);
        chrome.downloads.onChanged.removeListener(onChangedListener);
        
        // Avisar que o download foi concluído com sucesso
        sendResponse({ success: true, downloadId });
      }
    };
    
    chrome.downloads.onChanged.addListener(onChangedListener);

    // Verificar se é a última imagem
    const isLastImage = (message.index >= processingState.images.length - 1);
    console.log('Is last image?', isLastImage);

    if (isLastImage) {
      // Na última imagem, NÃO fechar a aba - mostrar mensagem de SUCESSO (se não houver falhas)
      console.log('🎉 ÚLTIMA IMAGEM! Mantendo aba aberta');
      
      // Calcular stats após incremento que acontecerá no handleProcessingComplete
      const finalCompleted = processingState.stats.completed + 1; // +1 porque ainda não incrementou
      const finalFailed = processingState.stats.failed;
      
      // Mostrar mensagem de SUCESSO apenas se NÃO houver falhas
      if (finalFailed === 0) {
        console.log('✅ Sem falhas - mostrando mensagem de sucesso');
        try {
          await chrome.tabs.sendMessage(processingTab, { 
            action: 'showSuccessMessage',
            totalVideos: finalCompleted,
            totalImages: processingState.images.length
          });
        } catch (error) {
          console.error('Error showing success message:', error);
        }
      } else {
        console.log(`⚠️ ${finalFailed} falhas detectadas - NÃO mostrando mensagem de sucesso`);
      }
      // NÃO fechar a aba na última imagem (independente de falhas)
    } else {
      // Imagens intermediárias: fechar aba normalmente
      console.log('🗑️ Closing tab:', processingTab);
      await chrome.tabs.remove(processingTab);
      processingTab = null;
    }
    
    // Já respondemos sucesso acima, aqui só garantimos
    sendResponse({ success: true });
    
    // ⭐ IMPORTANTE: Continuar para próxima imagem!
    console.log('🔄 Video download complete, continuing to next image...');
    handleProcessingComplete(true, message.index);
    
  } catch (error) {
    console.error('❌ Error downloading video:', error);
    sendResponse({ success: false, error: error.message });
    handleProcessingComplete(false, message.index);
  }
}

async function cancelProcessing() {
  processingState.isProcessing = false;
  processingState.isPaused = false;
  
  if (processingTab) {
    try {
      await chrome.tabs.remove(processingTab);
    } catch (error) {
      console.error('Error closing processing tab:', error);
    }
    processingTab = null;
  }

  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }

  await saveState();
}

// ========================= INICIALIZAÇÃO ==========================
chrome.runtime.onInstalled.addListener(() => {
  console.log('🔧 Background script installed');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Background script started');
  ensureStateLoaded();
});

// ========================= MESSAGE FROM CONTENT: INIT ==========================
// Content script chama isto quando está pronto para receber a imagem
// Não é mais usado diretamente aqui, pois enviamos processImage manualmente.

// (mantido para compatibilidade futura, se necessário)
function onContentReady(tabId, imageDataUrl, imageName, index, usePrompts, prompt) {
  chrome.tabs.sendMessage(tabId, {
    action: 'processImage',
    imageDataUrl,
    imageName,
    index,
    usePrompts,
    prompt
  });
}
