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
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.templates)) {
      state.templates = parsed.templates;
      renderTemplateList();
      setStatus('ローカル保存のテンプレートを読み込みました');
    }
  } catch (error) {
    console.error(error);
  }
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

function drawOverlay(rect) {
  overlayCanvas.width = previewImage.clientWidth;
  overlayCanvas.height = previewImage.clientHeight;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!rect) {
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
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
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
  const x1 = Math.min(width, maxX + padding);
  const y1 = Math.min(height, maxY + padding);

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

captureButton.addEventListener('click', captureFrame);
registerButton.addEventListener('click', registerTemplate);
exportButton.addEventListener('click', exportTemplates);
importInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) {
    importTemplates(file);
  }
});

previewImage.addEventListener('load', () => {
  drawOverlay(state.lastRect);
});

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('このブラウザはカメラの取得に対応していません。Chrome や Edge などの最新ブラウザで開いてください。');
    return;
  }

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    setStatus('カメラは HTTPS または localhost からのみ使用できます。ローカルサーバーでページを開いてください。');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    setStatus('カメラを開始しました');
  } catch (error) {
    console.error(error);
    const message = error && error.message ? error.message : '不明なエラー';
    setStatus(`カメラの起動に失敗しました: ${message}`);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadTemplates();
  startCamera();
});





































































































































































});  startCamera();  loadTemplates();window.addEventListener('DOMContentLoaded', () => {}  }    setStatus('カメラの起動に失敗しました。権限を確認してください。');    console.error(error);  } catch (error) {    setStatus('カメラを開始しました');    video.srcObject = stream;    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });  try {async function startCamera() {});  drawOverlay(state.lastRect);  overlayCanvas.height = previewImage.clientHeight;  overlayCanvas.width = previewImage.clientWidth;previewImage.addEventListener('load', () => {});  }    importTemplates(file);  if (file) {  const file = event.target.files?.[0];importInput.addEventListener('change', (event) => {exportButton.addEventListener('click', () => exportTemplates());registerButton.addEventListener('click', () => registerTemplate());captureButton.addEventListener('click', () => captureFrame());}  reader.readAsText(file);  };    }      setStatus('テンプレートの読み込みに失敗しました');      console.error(error);    } catch (error) {      setStatus('ローカルディスクからテンプレートを読み込みました');      renderTemplateList();      saveTemplates();      state.templates = parsed.templates;      }        throw new Error('テンプレート形式が無効です');      if (!Array.isArray(parsed.templates)) {      const parsed = JSON.parse(reader.result);    try {  reader.onload = () => {  const reader = new FileReader();function importTemplates(file) {}  setStatus('テンプレートをローカルディスクに保存しました');  URL.revokeObjectURL(url);  a.click();  a.download = 'ocr-templates.json';  a.href = url;  const a = document.createElement('a');  const url = URL.createObjectURL(blob);  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });  const payload = { templates: state.templates };function exportTemplates() {}  templateLabel.value = '';  setStatus(`テンプレート「${label}」を登録しました`);  renderTemplateList();  saveTemplates();  state.templates.push(template);  };    createdAt: new Date().toISOString(),    height: state.lastRect.height,    width: state.lastRect.width,    imageDataUrl,    label,    id: `template-${Date.now()}`,  const template = {  const imageDataUrl = cropRegion(state.lastRect);  }    return;    setStatus('テンプレートのラベルを入力してください');  if (label.length === 0) {  const label = templateLabel.value.trim();  }    return;    setStatus('先に「キャプチャ」を実行して認識領域を取得してください');  if (!state.lastRect) {function registerTemplate() {}  setStatus('キャプチャ完了 — 数字領域をオレンジの枠で表示しています');  candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height}`;  recognizedValue.textContent = '候補を検出しました';  drawOverlay(rect);  }    return;    drawOverlay(null);    candidateInfo.textContent = '数字の候補領域が見つかりません。';    recognizedValue.textContent = '未認識';    setStatus('数字領域が検出できませんでした。明るさや位置を調整してください。');  if (!rect) {  state.lastRect = rect;  const rect = detectNumberArea(imageData);  const imageData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);  state.lastCapture = dataUrl;  previewImage.src = dataUrl;  const dataUrl = captureCanvas.toDataURL('image/png');  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);function captureFrame() {}  return buffer.toDataURL('image/png');  ctx.putImageData(imageData, 0, 0);  const ctx = buffer.getContext('2d');  buffer.height = rect.height;  buffer.width = rect.width;  const buffer = document.createElement('canvas');  const imageData = captureCtx.getImageData(rect.x, rect.y, rect.width, rect.height);function cropRegion(rect) {}  return rect;  };    height: Math.min(height - 1, maxY - minY + padding * 2),    width: Math.min(width - 1, maxX - minX + padding * 2),    y: Math.max(0, minY - padding),    x: Math.max(0, minX - padding),  const rect = {  const padding = 8;  }    return null;  if (dark < minArea || maxX <= minX || maxY <= minY) {  const minArea = 1000;  }    }      }        if (y > maxY) maxY = y;        if (y < minY) minY = y;        if (x > maxX) maxX = x;        if (x < minX) minX = x;        dark += 1;      if (gray < 150) {      const gray = (r + g + b) / 3;      const b = data[offset + 2];      const g = data[offset + 1];      const r = data[offset];      const offset = (y * width + x) * 4;    for (let x = 0; x < width; x += 1) {  for (let y = 0; y < height; y += 1) {  let dark = 0;  let maxY = 0;  let maxX = 0;  let minY = height;  let minX = width;  const { data, width, height } = imageData;function detectNumberArea(imageData) {}9