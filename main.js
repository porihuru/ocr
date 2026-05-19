// JST: 2026-05-19 2 / main.js
// OCRテンプレート認識 修復版 + 複数桁対応 + 数字以外除外 + 二値化/ノイズ除去
// 目的：カメラ起動・キャプチャ・候補領域表示・テンプレート保存に加え、登録テンプレートとの画像比較で複数桁数字を判定する。

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

// [CFG-01] テンプレート比較用の正規化サイズ。数字画像をこのサイズに縮小して比較する。
const FEATURE_WIDTH = 24;
const FEATURE_HEIGHT = 32;
const DARK_THRESHOLD = 150;
const MIN_COMPONENT_PIXELS = 12;
const MIN_DIGIT_WIDTH = 3;
const MIN_DIGIT_HEIGHT = 8;
const MAX_DIGIT_COUNT = 12;
const MAX_ACCEPT_SCORE = 0.45;

const state = {
  templates: [],
  lastCapture: null,
  lastRect: null,
  lastFeature: null,
  lastDigitRects: [],
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
      state.templates = parsed.templates.map(normalizeTemplate);
      saveTemplates();
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

function normalizeTemplate(template) {
  if (!template) {
    return template;
  }

  if (!template.feature && template.imageDataUrl) {
    template.featureStatus = 'needsRebuild';
  }

  return template;
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
    const featureMark = template.feature ? '照合可' : '再登録推奨';
    label.textContent = `${template.label} (${template.width}x${template.height}) ${featureMark}`;

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

  if (state.lastDigitRects && state.lastDigitRects.length > 0) {
    overlayCtx.strokeStyle = '#22c55e';
    overlayCtx.lineWidth = 2;
    state.lastDigitRects.forEach((digitRect) => {
      overlayCtx.strokeRect(digitRect.x * scaleX, digitRect.y * scaleY, digitRect.width * scaleX, digitRect.height * scaleY);
    });
  }
}

function isDarkPixel(data, width, x, y) {
  const offset = (y * width + x) * 4;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const gray = (r + g + b) / 3;
  return gray < DARK_THRESHOLD;
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
      if (isDarkPixel(data, width, x, y)) {
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

function detectDigitRectsInArea(areaRect) {
  const imageData = captureCtx.getImageData(areaRect.x, areaRect.y, areaRect.width, areaRect.height);
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const hasInk = [];
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      if (isDarkPixel(data, width, x, y)) {
        count += 1;
      }
    }
    hasInk[x] = count >= 1;
  }

  const segments = [];
  let inSegment = false;
  let startX = 0;
  let blankRun = 0;

  for (let x = 0; x < width; x += 1) {
    if (hasInk[x]) {
      if (!inSegment) {
        inSegment = true;
        startX = x;
      }
      blankRun = 0;
    } else if (inSegment) {
      blankRun += 1;
      if (blankRun >= 2) {
        segments.push({ startX, endX: x - blankRun });
        inSegment = false;
        blankRun = 0;
      }
    }
  }

  if (inSegment) {
    segments.push({ startX, endX: width - 1 });
  }

  const rects = [];
  segments.forEach((segment) => {
    let minX = segment.startX;
    let maxX = segment.endX;
    let minY = height;
    let maxY = -1;
    let pixels = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = segment.startX; x <= segment.endX; x += 1) {
        if (isDarkPixel(data, width, x, y)) {
          pixels += 1;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const digitWidth = maxX - minX + 1;
    const digitHeight = maxY - minY + 1;
    const aspect = digitHeight > 0 ? digitWidth / digitHeight : 0;

    if (
      pixels >= MIN_COMPONENT_PIXELS &&
      digitWidth >= MIN_DIGIT_WIDTH &&
      digitHeight >= MIN_DIGIT_HEIGHT &&
      aspect <= 1.4
    ) {
      const padding = 3;
      rects.push({
        x: Math.max(0, areaRect.x + minX - padding),
        y: Math.max(0, areaRect.y + minY - padding),
        width: Math.min(captureCanvas.width - (areaRect.x + minX - padding), digitWidth + padding * 2),
        height: Math.min(captureCanvas.height - (areaRect.y + minY - padding), digitHeight + padding * 2),
        pixels,
      });
    }
  });

  return rects.slice(0, MAX_DIGIT_COUNT);
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

function buildFeatureFromRect(rect) {
  const source = document.createElement('canvas');
  source.width = rect.width;
  source.height = rect.height;
  const sourceCtx = source.getContext('2d');
  const imageData = captureCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
  sourceCtx.putImageData(imageData, 0, 0);

  const normalized = document.createElement('canvas');
  normalized.width = FEATURE_WIDTH;
  normalized.height = FEATURE_HEIGHT;
  const normalizedCtx = normalized.getContext('2d');
  normalizedCtx.fillStyle = '#ffffff';
  normalizedCtx.fillRect(0, 0, FEATURE_WIDTH, FEATURE_HEIGHT);
  normalizedCtx.drawImage(source, 0, 0, FEATURE_WIDTH, FEATURE_HEIGHT);

  const normalizedData = normalizedCtx.getImageData(0, 0, FEATURE_WIDTH, FEATURE_HEIGHT).data;
  const feature = [];

  for (let i = 0; i < normalizedData.length; i += 4) {
    const r = normalizedData[i];
    const g = normalizedData[i + 1];
    const b = normalizedData[i + 2];
    const gray = (r + g + b) / 3;
    feature.push(gray < DARK_THRESHOLD ? 1 : 0);
  }

  return feature;
}

function compareFeatures(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 999999;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      diff += 1;
    }
  }
  return diff / a.length;
}

function recognizeByTemplate(feature) {
  const usableTemplates = state.templates.filter((template) => {
    return Array.isArray(template.feature) && /^[0-9]$/.test(String(template.label));
  });

  if (usableTemplates.length === 0) {
    return null;
  }

  let best = null;
  usableTemplates.forEach((template) => {
    const score = compareFeatures(feature, template.feature);
    if (!best || score < best.score) {
      best = { template, score };
    }
  });

  if (best && best.score > MAX_ACCEPT_SCORE) {
    return null;
  }

  return best;
}

function recognizeMultipleDigits(areaRect) {
  const digitRects = detectDigitRectsInArea(areaRect);
  state.lastDigitRects = digitRects;

  if (digitRects.length === 0) {
    return null;
  }

  const parts = [];
  const details = [];
  let accepted = 0;

  digitRects.forEach((digitRect, index) => {
    const feature = buildFeatureFromRect(digitRect);
    const result = recognizeByTemplate(feature);
    if (result) {
      accepted += 1;
      parts.push(String(result.template.label));
      details.push(`${index + 1}:${result.template.label}(${Math.round((1 - result.score) * 100)}%)`);
    } else {
      parts.push('?');
      details.push(`${index + 1}:不明`);
    }
  });

  return {
    text: parts.join(''),
    accepted,
    total: digitRects.length,
    details: details.join(' / '),
  };
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
  state.lastFeature = null;
  state.lastDigitRects = [];

  if (!rect) {
    setStatus('数字領域が検出できませんでした。明るさや位置を調整してください。');
    recognizedValue.textContent = '未認識';
    candidateInfo.textContent = '数字の候補領域が見つかりません。';
    drawOverlay(null);
    return;
  }

  state.lastFeature = buildFeatureFromRect(rect);
  const multiResult = recognizeMultipleDigits(rect);
  const singleResult = recognizeByTemplate(state.lastFeature);

  if (multiResult && multiResult.total > 1) {
    recognizedValue.textContent = multiResult.text;
    candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height} / 桁数: ${multiResult.total} / 読取: ${multiResult.details}`;
    setStatus(`数字を読み取りました — ${multiResult.text}`);
  } else if (singleResult) {
    const percent = Math.round((1 - singleResult.score) * 100);
    recognizedValue.textContent = singleResult.template.label;
    candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height} / 一致度: ${percent}% / 差分: ${singleResult.score.toFixed(3)}`;
    setStatus(`数字を読み取りました — ${singleResult.template.label}`);
  } else if (multiResult) {
    recognizedValue.textContent = multiResult.text;
    candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height} / 桁数: ${multiResult.total} / 読取: ${multiResult.details}`;
    setStatus('数字候補を検出しました。一部の数字は不明です。');
  } else {
    recognizedValue.textContent = '候補を検出しました';
    candidateInfo.textContent = `検出領域: x=${rect.x}, y=${rect.y}, w=${rect.width}, h=${rect.height} / 照合可能な数字テンプレートがありません`;
    setStatus('数字候補を検出しました。0〜9を1つずつテンプレート登録してください。');
  }

  drawOverlay(rect);
}

function registerTemplate() {
  if (!state.lastRect) {
    setStatus('先に「数字を読む」を実行して認識領域を取得してください');
    return;
  }

  const label = templateLabel.value.trim();
  if (!/^[0-9]$/.test(label)) {
    setStatus('テンプレートのラベルは 0〜9 の数字1文字で入力してください');
    return;
  }

  const rectForTemplate = state.lastDigitRects && state.lastDigitRects.length === 1 ? state.lastDigitRects[0] : state.lastRect;
  const imageDataUrl = cropRegion(rectForTemplate);
  const feature = buildFeatureFromRect(rectForTemplate);
  const template = {
    id: `template-${Date.now()}`,
    label,
    imageDataUrl,
    feature,
    featureWidth: FEATURE_WIDTH,
    featureHeight: FEATURE_HEIGHT,
    width: rectForTemplate.width,
    height: rectForTemplate.height,
    createdAt: new Date().toISOString(),
  };

  state.templates.push(template);
  saveTemplates();
  renderTemplateList();
  setStatus(`数字テンプレート「${label}」を登録しました。次回から複数桁読取に使用できます。`);
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

      state.templates = parsed.templates.map(normalizeTemplate);
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
