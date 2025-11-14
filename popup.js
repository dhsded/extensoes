let state = {
  isProcessing: false,
  isPaused: false,
  currentIndex: 0,
  images: [],
  stats: { completed: 0, failed: 0 },
  startTime: null
};

let timerInterval = null;
let configLoaded = false; // Flag para carregar config apenas uma vez

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const imageList = document.getElementById('imageList');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const cancelBtn = document.getElementById('cancelBtn');
const clearBtn = document.getElementById('clearBtn');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressCount = document.getElementById('progressCount');
const statusText = document.getElementById('statusText');
const dashboard = document.getElementById('dashboard');
const totalImages = document.getElementById('totalImages');
const videosGenerated = document.getElementById('videosGenerated');
const completedCount = document.getElementById('completedCount');
const failedCount = document.getElementById('failedCount');
const totalTime = document.getElementById('totalTime');
const successRate = document.getElementById('successRate');
const avgTime = document.getElementById('avgTime');
const currentStatus = document.getElementById('currentStatus');
const successMessage = document.getElementById('successMessage');

const usePromptsCheckbox = document.getElementById('usePromptsCheckbox');
const promptsContainer = document.getElementById('promptsContainer');
const promptsTextarea = document.getElementById('promptsTextarea');
const usePauseCheckbox = document.getElementById('usePauseCheckbox');
const pauseContainer = document.getElementById('pauseContainer');
const pauseEveryInput = document.getElementById('pauseEveryInput');
const pauseDurationInput = document.getElementById('pauseDurationInput');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const clearConfigBtn = document.getElementById('clearConfigBtn');
const uploadPromptsBtn = document.getElementById('uploadPromptsBtn');
const promptsFileInput = document.getElementById('promptsFileInput');

async function loadState() {
  const response = await chrome.runtime.sendMessage({ action: 'getState' });
  state = response.state;
  
  // Buscar dataUrls do IndexedDB e fazer merge com metadados
  if (state.images.length > 0) {
    const imagesFromDB = await DB.getAllImages();
    
    // Fazer merge: metadados do state + dataUrl do IndexedDB
    state.images = state.images.map(meta => {
      const imgData = imagesFromDB.find(img => img.id === meta.id);
      return {
        ...meta,
        dataUrl: imgData ? imgData.dataUrl : null
      };
    });
  }
  
  updateUI();
  
  // Carregar configurações salvas apenas na primeira vez
  if (!configLoaded) {
    await loadSavedConfig();
    configLoaded = true;
  }
}

async function loadSavedConfig() {
  try {
    const result = await chrome.storage.local.get(['savedConfig']);
    if (result.savedConfig) {
      const config = result.savedConfig;
      
      // Restaurar checkboxes
      usePromptsCheckbox.checked = config.usePrompts || false;
      usePauseCheckbox.checked = config.usePause || false;
      
      // Restaurar prompts
      if (config.prompts) {
        promptsTextarea.value = config.prompts;
      }
      
      // Restaurar valores de pausa
      if (config.pauseEvery) pauseEveryInput.value = config.pauseEvery;
      if (config.pauseDuration) pauseDurationInput.value = config.pauseDuration;
      
      // Mostrar containers se necessário
      promptsContainer.style.display = config.usePrompts ? 'block' : 'none';
      pauseContainer.style.display = config.usePause ? 'block' : 'none';
      
      console.log('✅ Configurações carregadas do storage');
    }
  } catch (error) {
    console.error('Erro ao carregar configurações:', error);
  }
}

async function saveConfig() {
  try {
    const config = {
      usePrompts: usePromptsCheckbox.checked,
      prompts: promptsTextarea.value.trim(),
      usePause: usePauseCheckbox.checked,
      pauseEvery: parseInt(pauseEveryInput.value) || 5,
      pauseDuration: parseInt(pauseDurationInput.value) || 30
    };
    
    await chrome.storage.local.set({ savedConfig: config });
    
    // Feedback visual
    saveConfigBtn.textContent = '✅ Salvo!';
    setTimeout(() => {
      saveConfigBtn.textContent = '💾 Salvar';
    }, 2000);
    
    console.log('✅ Configurações salvas:', config);
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    alert('Erro ao salvar configurações');
  }
}

async function clearConfig() {
  if (confirm('Tem certeza que deseja limpar as configurações salvas?')) {
    try {
      await chrome.storage.local.remove(['savedConfig']);
      
      // Resetar campos
      usePromptsCheckbox.checked = false;
      usePauseCheckbox.checked = false;
      promptsTextarea.value = '';
      pauseEveryInput.value = 5;
      pauseDurationInput.value = 30;
      promptsContainer.style.display = 'none';
      pauseContainer.style.display = 'none';
      
      // Feedback visual
      clearConfigBtn.textContent = '✅ Limpo!';
      setTimeout(() => {
        clearConfigBtn.textContent = '🗑️ Limpar';
      }, 2000);
      
      console.log('✅ Configurações limpas');
    } catch (error) {
      console.error('Erro ao limpar configurações:', error);
    }
  }
}

function updateUI() {
  renderImages();
  updateProgress();
  updateStats();
  updateButtons();
  
  if (state.isProcessing) {
    progressSection.style.display = 'block';
    dashboard.style.display = 'block';
    startTimer();
  } else {
    stopTimer();
    // Mostrar dashboard se houver imagens processadas
    if (state.images.length > 0 && (state.stats.completed > 0 || state.stats.failed > 0)) {
      dashboard.style.display = 'block';
    }
  }
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  addImages(files);
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  addImages(files);
  fileInput.value = '';
});

usePromptsCheckbox.addEventListener('change', (e) => {
  promptsContainer.style.display = e.target.checked ? 'block' : 'none';
});

usePauseCheckbox.addEventListener('change', (e) => {
  pauseContainer.style.display = e.target.checked ? 'block' : 'none';
});

saveConfigBtn.addEventListener('click', saveConfig);
clearConfigBtn.addEventListener('click', clearConfig);

// Upload de prompts via arquivo .txt
uploadPromptsBtn.addEventListener('click', () => promptsFileInput.click());

promptsFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    promptsTextarea.value = text;
    
    // Feedback visual
    uploadPromptsBtn.textContent = '✅ Carregado!';
    uploadPromptsBtn.style.background = '#10b981';
    uploadPromptsBtn.style.color = 'white';
    uploadPromptsBtn.style.borderColor = '#10b981';
    
    setTimeout(() => {
      uploadPromptsBtn.textContent = '📄 Carregar .txt';
      uploadPromptsBtn.style.background = 'white';
      uploadPromptsBtn.style.color = '#667eea';
      uploadPromptsBtn.style.borderColor = '#667eea';
    }, 2000);
    
    console.log('✅ Prompts carregados do arquivo:', file.name);
  } catch (error) {
    console.error('Erro ao carregar arquivo:', error);
    alert('Erro ao carregar arquivo .txt');
  }
  
  // Limpar input
  promptsFileInput.value = '';
});

async function addImages(files) {
  if (!files || files.length === 0) {
    console.log('⚠️ Nenhuma imagem selecionada');
    return;
  }
  
  const totalFiles = files.length;
  
  console.log(`📦 Processando ${totalFiles} imagens...`);
  
  // Mostrar indicador de carregamento no dropZone
  const uploadArea = document.getElementById('dropZone');
  const originalHTML = uploadArea.innerHTML;
  uploadArea.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 32px; margin-bottom: 10px;">📦</div>
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 5px;">Carregando imagens...</div>
      <div id="batchProgress" style="font-size: 14px; color: #667eea;">0 / ${totalFiles}</div>
    </div>
  `;
  
  try {
    // Carregar todas as imagens em paralelo
    const newImages = await Promise.all(
      Array.from(files).map((file, index) => {
        return new Promise((resolve, reject) => {
          const id = `${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
          const reader = new FileReader();
          
          reader.onload = (e) => {
            resolve({
              id,
              name: file.name,
              dataUrl: e.target.result,
              status: 'pending'
            });
            
            // Atualizar progresso
            const progressEl = document.getElementById('batchProgress');
            if (progressEl) {
              const currentCount = parseInt(progressEl.textContent.split(' / ')[0]) + 1;
              progressEl.textContent = `${currentCount} / ${totalFiles}`;
            }
          };
          
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      })
    );
    
    console.log(`✅ ${newImages.length} imagens carregadas, salvando no IndexedDB...`);
    
    // Salvar DIRETO no IndexedDB (sem passar pelo background)
    await DB.addImages(newImages);
    
    // Notificar background que imagens foram adicionadas (sem enviar dados pesados)
    await chrome.runtime.sendMessage({
      action: 'imagesAdded',
      count: newImages.length
    });
    
    console.log(`✅ Todas as ${totalFiles} imagens salvas com sucesso!`);
    
    // Restaurar interface original
    const uploadAreaFinal = document.getElementById('dropZone');
    uploadAreaFinal.innerHTML = originalHTML;
    
    // Recarregar estado para mostrar imagens
    await loadState();
    
  } catch (error) {
    console.error('❌ Erro ao adicionar imagens:', error);
    const uploadAreaError = document.getElementById('dropZone');
    uploadAreaError.innerHTML = originalHTML;
    alert(`Erro ao carregar imagens: ${error.message}`);
  }
}

function renderImages() {
  if (state.images.length === 0) {
    imageList.innerHTML = '';
    return;
  }

  imageList.innerHTML = state.images.map((img, index) => {
    // Mostrar preview apenas se tiver dataUrl válido (completo)
    const hasValidPreview = img.dataUrl && img.dataUrl.startsWith('data:image');
    const canReorder = !state.isProcessing && img.status === 'pending';
    
    return `
      <div class="image-item" 
           data-id="${img.id}" 
           data-index="${index}"
           ${canReorder ? 'draggable="true"' : ''}>
        ${hasValidPreview ? 
          `<img src="${img.dataUrl}" class="image-preview" alt="${img.name}">` :
          `<div class="image-preview-placeholder">
            <div class="image-icon">🖼️</div>
          </div>`
        }
        <div class="image-info">
          <div class="image-name">${index + 1}. ${img.name}</div>
          <div class="image-status status-${img.status}">
            ${getStatusText(img.status)}
          </div>
        </div>
        ${canReorder ? `<button class="remove-btn" data-id="${img.id}">✕</button>` : ''}
      </div>
    `;
  }).join('');
  
  // Adicionar event listeners para drag and drop
  setupDragAndDrop();
  attachRemoveListeners();
}

function getStatusText(status) {
  const texts = {
    pending: '⏳ Aguardando',
    processing: '⚙️ Processando...',
    uploading: '📤 Fazendo upload...',
    generating: '🎬 Gerando vídeo...',
    downloading: '⬇️ Baixando...',
    completed: '✅ Concluído',
    failed: '❌ Falha'
  };
  return texts[status] || status;
}

window.removeImage = async function(id) {
  await chrome.runtime.sendMessage({
    action: 'removeImage',
    id: id
  });
  await loadState();
};

function attachRemoveListeners() {
  const buttons = imageList.querySelectorAll('.remove-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      await window.removeImage(id);
    });
  });
}

// Delegação de eventos para maior robustez contra re-render
imageList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.remove-btn');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  if (!id) return;
  await window.removeImage(id);
});

let draggedElement = null;
let draggedIndex = null;

function setupDragAndDrop() {
  const items = document.querySelectorAll('.image-item[draggable="true"]');
  
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedElement = item;
      draggedIndex = parseInt(item.dataset.index);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    item.addEventListener('dragend', (e) => {
      item.classList.remove('dragging');
      // Remover classes de todos os itens
      items.forEach(i => i.classList.remove('drag-over'));
    });
    
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      if (draggedElement !== item) {
        item.classList.add('drag-over');
      }
    });
    
    item.addEventListener('dragleave', (e) => {
      item.classList.remove('drag-over');
    });
    
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      
      if (draggedElement === item) return;
      
      const dropIndex = parseInt(item.dataset.index);
      
      // Reordenar array de imagens
      const newImages = [...state.images];
      const [movedImage] = newImages.splice(draggedIndex, 1);
      newImages.splice(dropIndex, 0, movedImage);
      
      // Atualizar estado
      await chrome.runtime.sendMessage({
        action: 'reorderImages',
        images: newImages
      });
      
      await loadState();
      
      console.log(`✅ Imagem movida de posição ${draggedIndex + 1} para ${dropIndex + 1}`);
    });
  });
}

function updateButtons() {
  const hasImages = state.images.length > 0;
  const canStart = hasImages && !state.isProcessing;
  
  startBtn.disabled = !canStart;
  
  if (state.isProcessing) {
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-flex';
    cancelBtn.style.display = 'inline-flex';
    clearBtn.disabled = true;
    
    pauseBtn.innerHTML = state.isPaused 
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Retomar'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pausar';
  } else {
    startBtn.style.display = 'inline-flex';
    pauseBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    clearBtn.disabled = false;
  }
}

startBtn.addEventListener('click', async () => {
  const usePrompts = usePromptsCheckbox.checked;
  const prompts = usePrompts ? promptsTextarea.value.split('\n').filter(p => p.trim()) : [];
  
  const usePause = usePauseCheckbox.checked;
  const pauseEvery = usePause ? parseInt(pauseEveryInput.value) || 5 : 0;
  const pauseDuration = usePause ? parseInt(pauseDurationInput.value) || 30 : 0;
  
  await chrome.runtime.sendMessage({ 
    action: 'startProcessing',
    options: {
      usePrompts,
      prompts,
      pauseEvery,
      pauseDuration
    }
  });
  await loadState();
});

pauseBtn.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'pauseProcessing' });
  state.isPaused = response.isPaused;
  updateButtons();
});

cancelBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'cancelProcessing' });
  await loadState();
});

clearBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'clearAll' });
  await loadState();
  progressSection.style.display = 'none';
  dashboard.style.display = 'none';
  successMessage.style.display = 'none';
});

// Download relatório completo
const downloadReportBtn = document.getElementById('downloadReportBtn');
downloadReportBtn.addEventListener('click', async () => {
  console.log('📋 Solicitando geração de relatório...');
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'generateReport' });
    
    if (response.success && response.report) {
      // Criar blob e fazer download
      const blob = new Blob([response.report], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const filename = `grok-automator-relatorio-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.txt`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('✅ Relatório baixado:', filename);
      
      // Feedback visual
      const originalText = downloadReportBtn.innerHTML;
      downloadReportBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Relatório Baixado!
      `;
      downloadReportBtn.disabled = true;
      
      setTimeout(() => {
        downloadReportBtn.innerHTML = originalText;
        downloadReportBtn.disabled = false;
      }, 2000);
    } else {
      console.error('❌ Erro ao gerar relatório');
      alert('Erro ao gerar relatório. Verifique o console.');
    }
  } catch (error) {
    console.error('❌ Erro ao baixar relatório:', error);
    alert('Erro ao baixar relatório: ' + error.message);
  }
});

function updateProgress() {
  if (state.images.length === 0) return;
  
  const progress = ((state.currentIndex) / state.images.length) * 100;
  progressFill.style.width = `${Math.min(progress, 100)}%`;
  progressCount.textContent = `${state.currentIndex}/${state.images.length}`;
  
  if (state.currentIndex < state.images.length) {
    progressText.textContent = `Processando imagem ${state.currentIndex + 1}`;
    statusText.textContent = state.images[state.currentIndex]?.name || '';
  } else {
    progressText.textContent = 'Processamento concluído!';
    statusText.textContent = `${state.stats.completed} vídeos baixados, ${state.stats.failed} falhas`;
  }
}

function updateStats() {
  // Total de imagens
  totalImages.textContent = state.images.length;
  
  // Vídeos gerados com SUCESSO (apenas completed)
  videosGenerated.textContent = state.stats.completed;
  
  const totalProcessed = state.stats.completed + state.stats.failed;
  
  // Concluídos e falhas
  completedCount.textContent = state.stats.completed;
  failedCount.textContent = state.stats.failed;
  
  // Taxa de sucesso
  if (totalProcessed > 0) {
    const rate = (state.stats.completed / totalProcessed) * 100;
    successRate.textContent = `${rate.toFixed(1)}%`;
  } else {
    successRate.textContent = '0%';
  }
  
  // Tempo médio por vídeo
  if (state.stats.completed > 0 && state.startTime) {
    const elapsed = Date.now() - state.startTime;
    const avgMs = elapsed / state.stats.completed;
    const avgMin = Math.floor(avgMs / 60000);
    const avgSec = Math.floor((avgMs % 60000) / 1000);
    avgTime.textContent = `${avgMin}:${avgSec.toString().padStart(2, '0')}`;
  } else {
    avgTime.textContent = '--:--';
  }
  
  // Status atual
  if (state.isProcessing) {
    if (state.isPaused) {
      if (state.pauseEndTime) {
        const remainingMs = Math.max(0, state.pauseEndTime - Date.now());
        const rMin = Math.floor(remainingMs / 60000);
        const rSec = Math.floor((remainingMs % 60000) / 1000);
        currentStatus.textContent = `⏸️ Pausado (${rMin}:${String(rSec).padStart(2,'0')})`;
        statusText.textContent = `Intervalo restante: ${rMin}:${String(rSec).padStart(2,'0')}`;
      } else {
        currentStatus.textContent = '⏸️ Pausado';
      }
    } else if (state.currentIndex < state.images.length) {
      const currentImage = state.images[state.currentIndex];
      if (currentImage) {
        if (currentImage.status === 'processing' && state.imageStartTime) {
          const stuckMs = Date.now() - state.imageStartTime;
          if (stuckMs >= 300000) {
            const sMin = Math.floor(stuckMs / 60000);
            const sSec = Math.floor((stuckMs % 60000) / 1000);
            currentStatus.textContent = '⚠️ demorando mais que o normal';
            statusText.textContent = `Travado há ${sMin}:${String(sSec).padStart(2,'0')}`;
          } else {
            currentStatus.textContent = getStatusText(currentImage.status);
          }
        } else {
          currentStatus.textContent = getStatusText(currentImage.status);
        }
      } else {
        currentStatus.textContent = '⚙️ Processando';
      }
    } else {
      currentStatus.textContent = '✅ Concluído';
    }
  } else {
    if (state.images.length === 0) {
      currentStatus.textContent = 'Aguardando';
    } else if (totalProcessed === state.images.length && totalProcessed > 0) {
      // Verificar se TODOS foram bem-sucedidos (SEM falhas)
      if (state.stats.failed === 0) {
        currentStatus.textContent = '✅ Finalizado';
        // Mostrar mensagem de sucesso APENAS se não houver falhas
        successMessage.style.display = 'flex';
      } else {
        currentStatus.textContent = '⚠️ Concluído com Erros';
        successMessage.style.display = 'none';
      }
    } else {
      currentStatus.textContent = 'Pronto';
    }
  }
}

function startTimer() {
  if (!state.startTime) return;
  
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - state.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    totalTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stateUpdated') {
    state = message.state;
    updateUI();
  }
});

loadState();

setInterval(() => {
  if (state.isProcessing) {
    loadState();
  }
}, 2000);
