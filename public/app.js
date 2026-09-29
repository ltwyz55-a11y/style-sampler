const MAX_FILES = 8;
const MAX_SIZE = 12 * 1024 * 1024;
const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const $ = (selector) => document.querySelector(selector);
const fileInput = $('#file-input');
const dropzone = $('#dropzone');
const imageList = $('#image-list');
const imageCount = $('#image-count');
const subjectInput = $('#subject-input');
const charCount = $('#char-count');
const analyzeButton = $('#analyze-button');
const errorBanner = $('#error-banner');
const loadingPanel = $('#loading-panel');
const results = $('#results');
const promptOutput = $('#prompt-output');
const toast = $('#toast');
const isLocalFile = location.protocol === 'file:';
const deploymentConfig = window.STYLE_SAMPLER_CONFIG || {};
const apiBaseUrl = typeof deploymentConfig.apiBaseUrl === 'string' ? deploymentConfig.apiBaseUrl.replace(/\/$/, '') : '';
const needsApiAddress = deploymentConfig.requiresApiBaseUrl === true && !apiBaseUrl;
const apiUrl = (path) => apiBaseUrl + path;
let files = [];
let analysis = null;
let activeLanguage = 'zh';
let prompts = { zh: '', en: '' };
let busy = false;
let serviceReady = false;
let demo = false;
let toastTimer;

function showError(message) {
  errorBanner.querySelector('p').textContent = message;
  errorBanner.hidden = false;
}
function hideError() { errorBanner.hidden = true; }
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function pick(value, lang, fallback = '') {
  if (value && typeof value === 'object') return typeof value[lang] === 'string' ? value[lang] : fallback;
  return typeof value === 'string' ? value : fallback;
}
function renderFiles() {
  imageCount.textContent = files.length + ' / ' + MAX_FILES;
  imageList.replaceChildren();
  files.forEach((item) => {
    const tile = node('div', 'image-thumb');
    const image = node('img');
    image.src = item.url;
    image.alt = item.file.name;
    const name = node('span', 'image-name', item.file.name);
    name.title = item.file.name;
    const remove = node('button', 'image-remove', '×');
    remove.type = 'button';
    remove.disabled = busy;
    remove.setAttribute('aria-label', '移除 ' + item.file.name);
    remove.addEventListener('click', () => removeFile(item.id));
    tile.append(image, name, remove);
    imageList.append(tile);
  });
  dropzone.hidden = files.length >= MAX_FILES;
  $('#example').hidden = files.length > 0 || Boolean(analysis);
}
function addFiles(incoming) {
  if (busy) return;
  hideError();
  for (const file of Array.from(incoming || [])) {
    if (files.length >= MAX_FILES) { showError('每组最多上传 8 张图片。'); break; }
    if (!supported.has(file.type)) { showError('“' + file.name + '”格式不支持，请使用 PNG、JPG、WebP 或 GIF。'); continue; }
    if (file.size > MAX_SIZE || !file.size) { showError('“' + file.name + '”须为非空图片，且不超过 12 MB。'); continue; }
    if (files.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
    files.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  renderFiles();
  fileInput.value = '';
}
function removeFile(id) {
  if (busy) return;
  const index = files.findIndex((item) => item.id === id);
  if (index < 0) return;
  URL.revokeObjectURL(files[index].url);
  files.splice(index, 1);
  renderFiles();
}
function clearFiles() {
  files.forEach((item) => URL.revokeObjectURL(item.url));
  files = [];
  fileInput.value = '';
  renderFiles();
}
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        const transparent = file.type === 'image/png' || file.type === 'image/gif';
        const outputType = transparent ? 'image/png' : 'image/jpeg';
        const context = canvas.getContext('2d', {alpha:transparent});
        if (!context) throw new Error('无法读取图片。');
        let edge = 1600;
        let blob;
        for (let attempt = 0; attempt < 8; attempt++) {
          const scale = Math.min(1, edge / Math.max(image.naturalWidth,image.naturalHeight));
          canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
          if (!transparent) {context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);}
          context.drawImage(image,0,0,canvas.width,canvas.height);
          blob = await new Promise(done => canvas.toBlob(done,outputType,0.88));
          if (!blob) throw new Error('图片处理失败，请重试。');
          if (blob.size <= 768*1024) break;
          edge = Math.round(edge*0.75);
        }
        if (blob.size > 768*1024) throw new Error('图片“'+file.name+'”过大，请缩小后重试。');
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('图片读取失败。'));
        reader.onload = () => resolve({name:file.name,mime:outputType,data:reader.result});
        reader.readAsDataURL(blob);
      } catch (error) {reject(error);}
      finally {URL.revokeObjectURL(objectUrl);}
    };
    image.onerror = () => {URL.revokeObjectURL(objectUrl);reject(new Error('无法打开图片“'+file.name+'”。'));};
    image.src = objectUrl;
  });
}

function setLoading(active) {
  busy = active;
  analyzeButton.disabled = active || isLocalFile || !serviceReady;
  analyzeButton.querySelector('span').textContent = active ? '正在分析…' : '生成提示词';
  loadingPanel.hidden = !active;
  $('.workspace').setAttribute('aria-busy', String(active));
  [dropzone, fileInput, subjectInput, $('#show-example'), $('#reset-button'), $('#update-prompt')].forEach((el) => { el.disabled = active; });
  document.querySelectorAll('.image-remove').forEach((el) => { el.disabled = active; });
}
function showPrompt() {
  document.querySelectorAll('.language-tab').forEach((tab) => {
    const active = tab.dataset.lang === activeLanguage;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  promptOutput.value = prompts[activeLanguage];
  $('#template-output').textContent = pick(analysis?.template, activeLanguage);
}
function selectLanguage(language) {
  if (!analysis) return;
  prompts[activeLanguage] = promptOutput.value;
  activeLanguage = language;
  showPrompt();
}
function buildPrompt(lang, subject) {
  return (lang === 'zh' ? '画面主体：' : 'Subject: ') + subject + '\n\n' +
    (lang === 'zh' ? '视觉风格：' : 'Visual style: ') + pick(analysis.sharedStyle, lang);
}
function renderResult(data, subject, isDemo = false) {
  analysis = data;
  demo = isDemo;
  activeLanguage = 'zh';
  prompts = { zh: pick(data.prompt, 'zh') || buildPrompt('zh', subject), en: pick(data.prompt, 'en') || buildPrompt('en', subject) };
  $('#demo-badge').hidden = !isDemo;
  $('#result-summary').textContent = pick(data.summary, 'zh');
  $('#shared-style').textContent = pick(data.sharedStyle, 'zh');
  $('#next-subject').value = subject;
  const grid = $('#element-grid');
  grid.replaceChildren();
  const confidenceLabels = { high: '置信度高', medium: '置信度中', low: '置信度低' };
  (Array.isArray(data.elements) ? data.elements : []).forEach((item) => {
    if (!item) return;
    const confidence = Object.hasOwn(confidenceLabels, item.confidence) ? item.confidence : 'low';
    const cell = node('div', 'element');
    const label = node('div', 'element-label', pick(item.label, 'zh', '视觉要素'));
    label.append(node('span', 'confidence-text ' + confidence, confidenceLabels[confidence]));
    cell.append(label, node('p', 'element-value', pick(item.value, 'zh')));
    grid.append(cell);
  });
  const common = $('#commonalities');
  common.replaceChildren();
  (Array.isArray(data.commonalities?.zh) ? data.commonalities.zh : []).forEach((text) => {
    const row = node('div', 'commonality');
    row.append(node('span', '', '·'), node('p', '', text));
    common.append(row);
  });
  const variations = $('#variations');
  variations.replaceChildren();
  (Array.isArray(data.variations) ? data.variations : []).forEach((item) => {
    if (!item) return;
    const row = node('div', 'variation');
    row.append(node('span', 'variation-name', item.image || '参考图片'), node('p', 'variation-description', pick(item, 'zh')));
    variations.append(row);
  });
  $('#confidence-note').textContent = pick(data.confidenceNote, 'zh') + ' 置信度为模型的判断，并非统计测量。';
  $('#template-details').open = false;
  $('#analysis-details').open = false;
  showPrompt();
  results.hidden = false;
  $('#results-title').focus({ preventScroll: true });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function runAnalysis() {
  if (busy) return;
  hideError();
  if (isLocalFile) return showError('当前为本地预览，请启动服务后分析。');
  if (!serviceReady) return showError('图片分析尚未启用，你可以先查看示例。');
  if (files.length < 2) return showError('请至少选择 2 张参考图片。');
  const subject = subjectInput.value.trim();
  if (!subject) { showError('请描述想生成的新主体或场景。'); subjectInput.focus(); return; }
  setLoading(true);
  $('#loading-status').textContent = '正在准备图片…';
  let prepared = [];
  try {
    prepared = await Promise.all(files.map((item) => prepareImage(item.file)));
    const totalBytes = prepared.reduce((total, image) => total + Math.floor((image.data.split(',')[1] || '').length * .75), 0);
    if (totalBytes > 6 * 1024 * 1024) throw new Error('图片处理后的总大小超过 6 MB，请减少图片数量。');
    $('#loading-status').textContent = '已开始云端分析，正在等待结果…';
    const response = await fetch(apiUrl('/api/analyze'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: prepared, subject }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '分析失败，请稍后重试。');
    if (!payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) throw new Error('分析结果格式不完整，请重试。');
    renderResult(payload.result, subject);
    clearFiles();
    showToast('分析完成，参考图片已清除。');
  } catch (error) {
    showError(error.message || '分析失败，请检查网络后重试。');
  } finally {
    prepared.forEach((image) => { image.data = ''; });
    setLoading(false);
  }
}
async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    const temp = node('textarea', 'sr-only');
    temp.value = text;
    document.body.append(temp);
    temp.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    temp.remove();
    showToast(copied ? successMessage : '复制失败，请手动选择文字复制。');
  }
}
function resetAnalysis() {
  if (busy) return;
  analysis = null;
  demo = false;
  prompts = { zh: '', en: '' };
  activeLanguage = 'zh';
  results.hidden = true;
  promptOutput.value = '';
  for (const id of ['result-summary', 'shared-style', 'element-grid', 'commonalities', 'variations', 'confidence-note', 'template-output']) $('#' + id).replaceChildren();
  $('#template-details').open = false;
  $('#analysis-details').open = false;
  $('#demo-badge').hidden = true;
  $('#next-subject').value = '';
  subjectInput.value = '';
  charCount.textContent = '0 / 1600';
  clearFiles();
  hideError();
  dropzone.focus({ preventScroll: true });
  $('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const sampleResult = {
  summary: { zh: '暖色平面插画，以简洁色块、柔和光线和低饱和绿色营造安静氛围。' },
  sharedStyle: { zh: '暖米色背景，低饱和鼠尾草绿与陶土橙配色；简洁几何色块，柔和均匀的光线，适度留白，平面插画质感。', en: 'A warm cream background with muted sage green and terracotta orange; simple geometric color blocks, soft even lighting, generous negative space, and a flat illustration finish.' },
  prompt: { zh: '一只在窗台打盹的橘猫。暖米色背景，低饱和鼠尾草绿与陶土橙配色，简洁几何色块，柔和均匀的光线，适度留白，营造安静舒适的平面插画。', en: 'An orange cat napping on a windowsill. A warm cream background with muted sage green and terracotta orange, simple geometric color blocks, soft even lighting, and generous negative space. A quiet, comfortable flat illustration.' },
  template: { zh: '描绘【主体与动作】，采用暖米色、鼠尾草绿和陶土橙的低饱和配色，简洁色块与柔和光线，保留留白，呈现安静的平面插画风格。', en: 'Depict [subject and action] with a muted palette of warm cream, sage green, and terracotta orange. Use simple color blocks, soft lighting, generous negative space, and a quiet flat illustration style.' },
  elements: [
    { label: { zh: '配色' }, value: { zh: '米色背景、绿色主体与橙色点缀。' }, confidence: 'high' },
    { label: { zh: '媒介与构图' }, value: { zh: '以几何图形概括物体，层次简洁。' }, confidence: 'high' },
    { label: { zh: '光线' }, value: { zh: '均匀柔和，阴影较弱。' }, confidence: 'medium' },
    { label: { zh: '具体制作工艺' }, value: { zh: '仅凭图像无法确定，提示词中不指定。' }, confidence: 'low' },
  ],
  commonalities: { zh: ['低饱和自然色系', '圆形和色块组成简洁画面', '留白与少量细节让主体更突出'] },
  variations: [{ image: '示例一 · 海边小屋', zh: '横向山丘形成前后层次，落日作为橙色点缀。' }, { image: '示例二 · 桌上花瓶', zh: '以花瓶为中心，枝叶与背景圆拱构成纵向结构。' }],
  confidenceNote: { zh: '这是用于说明界面的预设示例，未调用模型，也不代表对上传图片的分析。' },
};

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => addFiles(fileInput.files));
dropzone.addEventListener('dragover', (event) => { event.preventDefault(); if (!busy) dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); addFiles(event.dataTransfer.files); });
subjectInput.addEventListener('input', () => { charCount.textContent = subjectInput.value.length + ' / 1600'; });
promptOutput.addEventListener('input', () => { prompts[activeLanguage] = promptOutput.value; });
analyzeButton.addEventListener('click', runAnalysis);
errorBanner.querySelector('button').addEventListener('click', hideError);
document.querySelectorAll('.language-tab').forEach((tab) => tab.addEventListener('click', () => selectLanguage(tab.dataset.lang)));
$('#copy-prompt').addEventListener('click', () => copyText(promptOutput.value, '提示词已复制'));
$('#copy-template').addEventListener('click', () => copyText($('#template-output').textContent, '风格模板已复制'));
$('#download-prompt').addEventListener('click', () => {
  const blob = new Blob([(demo ? '示例结果 · 非实际分析\n\n' : '') + promptOutput.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = (demo ? 'example-' : '') + 'style-prompt-' + activeLanguage + '.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#update-prompt').addEventListener('click', () => {
  if (!analysis || busy) return;
  const subject = $('#next-subject').value.trim();
  if (!subject) { $('#next-subject').focus(); showToast('请先填写新的主体。'); return; }
  prompts[activeLanguage] = buildPrompt(activeLanguage, subject);
  showPrompt();
  showToast('已更新当前语言的提示词');
});
$('#reset-button').addEventListener('click', resetAnalysis);
$('#show-example').addEventListener('click', () => {
  if (analysis && !demo) { showToast('新建分析后可查看示例，当前编辑内容已保留。'); return; }
  if (demo) { results.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  renderResult(sampleResult, '一只在窗台打盹的橘猫', true);
});
window.addEventListener('beforeunload', () => { files.forEach((item) => URL.revokeObjectURL(item.url)); });
$('#local-notice').hidden = !isLocalFile;
analyzeButton.disabled = true;
if (!isLocalFile) {
  const notice = $('#service-notice');
  notice.hidden = false;
  notice.textContent = '正在连接分析服务…';
  if (needsApiAddress) {
    notice.textContent = '图片分析服务尚未连接，可以先查看示例和预览图片。';
  } else fetch(apiUrl('/api/status')).then(async response => {
    if (!response.ok) throw new Error('unavailable');
    const status = await response.json();
    serviceReady = status.ready === true;
    analyzeButton.disabled = busy || !serviceReady;
    notice.hidden = serviceReady;
    notice.textContent = serviceReady ? '' : '图片分析尚未启用，可以先查看示例和预览图片。';
  }).catch(() => {notice.textContent = '暂时无法连接分析服务，请稍后刷新页面。';});
}
renderFiles();
