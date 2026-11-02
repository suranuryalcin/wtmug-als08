/* ============================================================
   ALŞ08 — Ortak Yardımcılar
   - Sohbet mesajı ekleme
   - Dosya parçalama / birleştirme (backpressure destekli)
   - İlerleme çubuğu
   - Dosya önizleme / indirme
   ============================================================ */

const CHUNK_SIZE = 16 * 1024; // 16 KB

// ---------- DOM yardımcıları ----------
const $ = (sel) => document.querySelector(sel);

const messagesEl   = $('#messages');
const progressArea = $('#progress-area');
const progressBar  = $('#progress-bar');
const progressPct  = $('#progress-percent');
const progressName = $('#progress-name');

// ---------- Zaman ----------
function nowTime() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Mesaj balonu ----------
function addMessage(text, who = 'theirs') {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.innerHTML = `${escapeHtml(text)}<span class="time">${nowTime()}</span>`;
  messagesEl.appendChild(div);
  scrollBottom();
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollBottom();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Dosya boyutu biçimlendirme ----------
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ---------- İlerleme çubuğu ----------
function showProgress(name, percent) {
  progressArea.classList.remove('hidden');
  progressName.textContent = name;
  progressPct.textContent = percent + '%';
  progressBar.style.width = percent + '%';
}
function hideProgress() {
  setTimeout(() => {
    progressArea.classList.add('hidden');
    progressBar.style.width = '0%';
  }, 600);
}

// ============================================================
// DOSYA GÖNDERME (CHUNKING + BACKPRESSURE)
// ============================================================
// Protokol:
//   { type: 'file-start', id, name, size, mime }
//   { type: 'file-chunk', id, data: ArrayBuffer }
//   { type: 'file-end',   id }
// ============================================================

function sendFile(conn, file) {
  return new Promise((resolve, reject) => {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const total = file.size;
    let offset = 0;
    let aborted = false;

    // 1) Başlangıç bilgisi
    conn.send({
      type: 'file-start',
      id,
      name: file.name,
      size: total,
      mime: file.type || 'application/octet-stream'
    });

    addSystemMessage(`📤 Gönderiliyor: ${file.name} (${formatSize(total)})`);
    showProgress('Gönderiliyor: ' + file.name, 0);

    const reader = new FileReader();

    // DataChannel tamponu boşalana kadar bekle (backpressure)
    function waitForDrain(cb) {
      const channel = conn.dataChannel || conn._dc;
      if (!channel) { cb(); return; }

      const MAX_BUFFER = 8 * 1024 * 1024; // 8 MB
      if (channel.bufferedAmount < MAX_BUFFER) {
        cb();
        return;
      }

      const timer = setInterval(() => {
        if (aborted) {
          clearInterval(timer);
          reject(new Error('İptal edildi'));
          return;
        }
        if (channel.bufferedAmount < MAX_BUFFER / 2) {
          clearInterval(timer);
          cb();
        }
      }, 50);
    }

    function readNext() {
      if (aborted) return;
      if (offset >= total) {
        conn.send({ type: 'file-end', id });
        showProgress('Gönderildi: ' + file.name, 100);
        hideProgress();
        addSystemMessage(`✅ Gönderildi: ${file.name}`);
        resolve();
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    }

    reader.onload = (e) => {
      const buf = e.target.result;
      waitForDrain(() => {
        try {
          conn.send({ type: 'file-chunk', id, data: buf });
        } catch (err) {
          reject(err);
          return;
        }
        offset += buf.byteLength;
        const pct = Math.round((offset / total) * 100);
        showProgress('Gönderiliyor: ' + file.name, pct);
        setTimeout(readNext, 0); // event loop'a nefes aldır
      });
    };

    reader.onerror = (err) => reject(err);
    readNext();
  });
}

// ============================================================
// DOSYA ALMA
// ============================================================
const incomingFiles = {}; // id -> { meta, chunks[], received }

function handleIncomingData(data, conn) {
  if (!data || typeof data !== 'object') return false;

  // --- Dosya başlangıcı ---
  if (data.type === 'file-start') {
    incomingFiles[data.id] = {
      meta: data,
      chunks: [],
      received: 0
    };
    addSystemMessage(`📥 Alınıyor: ${data.name} (${formatSize(data.size)})`);
    showProgress('Alınıyor: ' + data.name, 0);
    return true;
  }

  // --- Dosya parçası ---
  if (data.type === 'file-chunk') {
    const rec = incomingFiles[data.id];
    if (!rec) return true;

    // Tip güvencesi: ArrayBuffer, Uint8Array veya Blob gelebilir
    if (data.data instanceof ArrayBuffer) {
      rec.chunks.push(data.data);
      rec.received += data.data.byteLength;
    } else if (data.data && data.data.buffer instanceof ArrayBuffer) {
      // Uint8Array / TypedArray
      const buf = data.data.buffer.slice(
        data.data.byteOffset,
        data.data.byteOffset + data.data.byteLength
      );
      rec.chunks.push(buf);
      rec.received += buf.byteLength;
    } else if (data.data instanceof Blob) {
      rec.chunks.push(data.data);
      rec.received += data.data.size;
    } else {
      console.warn('Bilinmeyen chunk tipi:', typeof data.data);
      return true;
    }

    const pct = Math.round((rec.received / rec.meta.size) * 100);
    showProgress('Alınıyor: ' + rec.meta.name, pct);
    return true;
  }

  // --- Dosya sonu ---
  if (data.type === 'file-end') {
    const rec = incomingFiles[data.id];
    if (!rec) return true;
    const blob = new Blob(rec.chunks, { type: rec.meta.mime });
    delete incomingFiles[data.id];
    hideProgress();
    addSystemMessage(`✅ Alındı: ${rec.meta.name}`);
    renderReceivedFile(blob, rec.meta.name, rec.meta.mime);
    return true;
  }

  // --- Metin mesajı ---
  if (data.type === 'text') {
    addMessage(data.text, 'theirs');
    return true;
  }

  return false;
}

// ============================================================
// ALINAN DOSYAYI GÖSTER (önizleme veya indirme)
// ============================================================
function renderReceivedFile(blob, name, mime) {
  const url = URL.createObjectURL(blob);
  const div = document.createElement('div');
  div.className = 'msg theirs file-msg';

  let preview = '';
  if (mime.startsWith('image/')) {
    preview = `<img src="${url}" alt="${escapeHtml(name)}" />`;
  } else if (mime.startsWith('video/')) {
    preview = `<video src="${url}" controls></video>`;
  } else if (mime.startsWith('audio/')) {
    preview = `<audio src="${url}" controls style="width:100%"></audio>`;
  }

  div.innerHTML = `
    ${preview}
    <div class="file-name">${escapeHtml(name)}</div>
    <div class="file-size">${formatSize(blob.size)}</div>
    <a class="download-link" href="${url}" download="${escapeHtml(name)}">⬇ İndir</a>
    <span class="time">${nowTime()}</span>
  `;
  messagesEl.appendChild(div);
  scrollBottom();
}

// ============================================================
// METİN GÖNDERME
// ============================================================
function sendText(conn, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  conn.send({ type: 'text', text: trimmed });
  addMessage(trimmed, 'mine');
}

// ============================================================
// SOHBET EKRANINA GEÇ
// ============================================================
function switchToChat() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const chat = document.getElementById('chat-screen');
  if (chat) chat.classList.add('active');
  addSystemMessage('🔒 Uçtan uca şifreli P2P bağlantı kuruldu.');
}

// ============================================================
// SOHBET EKRANI ORTAK OLAYLARI BAĞLA
// ============================================================
function bindChatEvents(conn, getConn) {
  const input = $('#message-input');
  const sendBtn = $('#send-btn');
  const fileInput = $('#file-input');
  const disconnectBtn = $('#disconnect-btn');

  function doSend() {
    const c = getConn();
    if (!c || !c.open) return;
    sendText(c, input.value);
    input.value = '';
    input.focus();
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const c = getConn();
    if (!c || !c.open) {
      alert('Bağlantı kapalı!');
      return;
    }
    try {
      await sendFile(c, file);
    } catch (err) {
      console.error('Dosya gönderme hatası:', err);
      addSystemMessage('❌ Dosya gönderilemedi: ' + err.message);
      hideProgress();
    }
    fileInput.value = '';
  });

  disconnectBtn.addEventListener('click', () => {
    const c = getConn();
    if (c) c.close();
    location.reload();
  });
}