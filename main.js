// JST: 2026-05-18 1 / main.js
// OCRテンプレート認識 修復版
// 目的：壊れた重複コードを除去し、カメラ起動・キャプチャ・候補領域表示・テンプレート保存を正常化する。

const video = document.getElementById('cameraView');
const captureButton = document.getElementById('captureButton');
const registerButton = document.getElementById('registerButton');
const exportButton = document.getElementById('exportButton');
const importInput = document.getElementById('importInput');
const templateLabel = document.getElementById('templateLabel');
const templateList = document.getElementById('templateList');
const previewImage = document.getElementById('previewImage');
const overlayCanvas = document.getElementById('overlayCanvas');
const statusArea = document.getElementById('statusArea');
const recognizedValue = document.getElementById('recognizedValue');
const candidateInfo = document.getElementById('candidateInfo');
const captureCanvas = document.getElementById('captureCanvas');
const captureCtx = captureCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

const state = {
  templates: [],
  lastCapture: null,
  lastRect: null,
};

function setStatus(text) {
  statusArea.textContent = text;
}

function loadTemplates() {
  const raw = localStorage.getItem('ocrTemplates');
  if (!raw) {
    renderTemplateList();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.templates)) {
      state.templates = parsed.templates;
      renderTemplateList();
      setStatus('ローカル保存のテンプレートを読み込みました');
      return;
    }
  } catch (error) {
    console.error(error);
  }

  renderTemplateList();
}

function saveTemplates() {
  const payload = { templates: state.templates };
  localStorage.setItem('ocrTemplates', JSON.stringify(payload));
}

function renderTemplateList() {
  templateList.innerHTML = '';

  if (state.templates.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'テンプレートがありません';
    templateList.appendChild(empty);
    return;
  }

  state.templates.forEach((template, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${template.label} (${template.width}x${template.height})`;

    const remove = document.createElement('button');
    remove.textContent = '削除';
    remove.style.background = '#ef4444';
    remove.style.marginLeft = '12px';
    remove.style.width = 'auto';
    remove.style.padding = '8px 12px';
    remove.addEventListener('click', () => {
      state.templates.splice(index, 1);
      saveTemplates();
      renderTemplateList();
      setStatus(`テンプレート「${template.label}」を削除しました`);
    });

    item.appendChild(label);
    item.appendChild(remove);
    templateList.appendChild(item);
  });
}

function syncCaptureCanvasSize() {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;

  if (captureCanvas.width !== width) {
    captureCanvas.width = width;
  }
  if (captureCanvas.height !== height) {
    captureCanvas.height = height;
  }
}

function drawOverlay(rect) {
  const displayWidth = previewImage.clientWidth;
  const displayHeight = previewImage.clientHeight;

  overlayCanvas.width = displayWidth;
  overlayCanvas.height = displayHeight;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!rect || displayWidth === 0 || displayHeight === 0) {
    return;
  }

  const scaleX = overlayCanvas.width / captureCanvas.width;
  const scaleY = overlayCanvas.height / captureCanvas.height;

  overlayCtx.strokeStyle = '#f59e0b';
  overlayCtx.lineWidth = 4;
  overlayCtx.strokeRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);

  overlayCtx.fillStyle = 'rgba(245, 158, 11, 0.18)';
  overlayCtx.fillRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
}

function detectNumberArea(imageData) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let dark = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const gray = (r + g + b) / 3;

      if (gray < 150) {
        dark += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const minArea = 1000;
  if (dark < minArea || maxX <= minX || maxY <= minY) {
    return null;
  }

  const padding = 8;
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(width, maxX + padding + 1);
  const y1 = Math.min(height, maxY + padding + 1);

  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function cropRegion(rect) {
  const imageData = captureCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
  const buffer = document.createElement('canvas');
  buffer.width = rect.width;
  buffer.height = rect.height;

  const ctx = buffer.getContext('2d');
  ctx.putImageData(imageData, 0, 0);

  return buffer.toDataURL('image/png');
}

function captureFrame() {
  if (!video.srcObject) {
    setStatus('カメラが開始されていません。ページを再読み込みして、カメラ権限を許可してください。');
    return;
  }

  if (video.readyState < 2) {
    setStatus('カメラ映像の準備中です。少し待ってからもう一度キャプチャしてください。');
    return;
  }

  syncCaptureCanvasSize();
  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

  const dataUrl = captureCanvas.toDataURL('image/png');
  previewImage.src = dataUrl;
  state.lastCapture = dataUrl;

  const imageData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
  const rect = detectNumberArea(imageData);
  state.lastRect = rect;

  if (!rect) {
    setStatus('数字領域が検出できませんでした。明るさや位置を調整してください。');
    recognizedValue.textContent = '未認識';
    candidateInfo.textContent = '数字の候補領域が見つかりません。';
    drawOverlay(null);
    return;
  }

  recognizedValue.textContent = '候補を検出しました';
  candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`;
  setStatus('キャプチャ完了 — 数字領域をオレンジの枠で表示しています');
  drawOverlay(rect);
}

function registerTemplate() {
  if (!state.lastRect) {
    setStatus('先に「キャプチャ」を実行して認識領域を取得してください');
    return;
  }

  const label = templateLabel.value.trim();
  if (label.length === 0) {
    setStatus('テンプレートのラベルを入力してください');
    return;
  }

  const imageDataUrl = cropRegion(state.lastRect);
  const template = {
    id: `template-${Date.now()}`,
    label,
    imageDataUrl,
    width: state.lastRect.width,
    height: state.lastRect.height,
    createdAt: new Date().toISOString(),
  };

  state.templates.push(template);
  saveTemplates();
  renderTemplateList();
  setStatus(`テンプレート「${label}」を登録しました`);
  templateLabel.value = '';
}

function exportTemplates() {
  const payload = { templates: state.templates };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = 'ocr-templates.json';
  a.click();

  URL.revokeObjectURL(url);
  setStatus('テンプレートをローカルディスクに保存しました');
}

function importTemplates(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.templates)) {
        throw new Error('テンプレート形式が無効です');
      }

      state.templates = parsed.templates;
      saveTemplates();
      renderTemplateList();
      setStatus('ローカルディスクからテンプレートを読み込みました');
    } catch (error) {
      console.error(error);
      setStatus('テンプレートの読み込みに失敗しました');
    }
  };

  reader.readAsText(file);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('このブラウザはカメラの取得に対応していません。Chrome や Edge などの新しいブラウザで開いてください。');
    return;
  }

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    setStatus('カメラは HTTPS または localhost からのみ使用できます。ローカルサーバーでページを開いてください。');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });

    video.srcObject = stream;
    setStatus('カメラを開始しました');
  } catch (error) {
    console.error(error);
    const message = error && error.message ? error.message : '不明なエラー';
    setStatus(`カメラの起動に失敗しました: ${message}`);
  }
}

function bindEvents() {
  captureButton.addEventListener('click', captureFrame);
  registerButton.addEventListener('click', registerTemplate);
  exportButton.addEventListener('click', exportTemplates);

  importInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
    if (file) {
      importTemplates(file);
    }
  });

  previewImage.addEventListener('load', () => {
    drawOverlay(state.lastRect);
  });

  window.addEventListener('resize', () => {
    drawOverlay(state.lastRect);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadTemplates();
  startCamera();
});
