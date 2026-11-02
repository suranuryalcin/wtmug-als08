/* ============================================================
   ALŞ08 — Mobil Arayüzü (Telefon)
   QR kod tara → peer ID al → Peer oluştur → connect()
   ============================================================ */

let peer = null;
let conn = null;
let scanner = null;

const scanStatus = document.getElementById('scan-status');

function setScanStatus(msg, cls = '') {
  scanStatus.textContent = msg;
  scanStatus.className = 'status ' + cls;
}

// ---------- QR tarayıcıyı başlat ----------
function startScanner() {
  scanner = new Html5Qrcode('reader');

  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      // QR okundu → p2p:// şemasını ayıkla
      let targetId = decodedText.trim();
      if (targetId.startsWith('p2p://')) {
        targetId = targetId.slice('p2p://'.length);
      }
      setScanStatus('QR okundu: ' + targetId, 'ok');
      stopScanner().then(() => connectToPeer(targetId));
    },
    (err) => { /* tarama hataları sessiz */ }
  ).then(() => {
    setScanStatus('Kamera hazır. QR kodu gösterin.');
  }).catch((err) => {
    console.error('Kamera hatası:', err);
    setScanStatus('Kamera açılamadı: ' + err, 'error');
  });
}

function stopScanner() {
  if (!scanner) return Promise.resolve();
  return scanner.stop().then(() => scanner.clear()).catch(() => {});
}

// ---------- Hedef Peer'a bağlan ----------
function connectToPeer(targetId) {
  setScanStatus('Bağlanılıyor…');

  if (peer) {
    peer.destroy();
    peer = null;
  }

  peer = new Peer(undefined, { debug: 1 });

  peer.on('open', (myId) => {
    console.log('Benim ID:', myId, '→ Hedef:', targetId);
    conn = peer.connect(targetId, { reliable: true });

    conn.on('open', () => {
      console.log('DataChannel açıldı');
      switchToChat();
      bindChatEvents(conn, () => conn);
      addSystemMessage('💻 Bilgisayara bağlandı.');
    });

    conn.on('data', (data) => {
      const handled = handleIncomingData(data, conn);
      if (!handled) {
        if (typeof data === 'string') addMessage(data, 'theirs');
      }
    });

    conn.on('close', () => {
      addSystemMessage('🔌 Bağlantı kapandı.');
    });

    conn.on('error', (err) => {
      console.error('Conn hatası:', err);
      addSystemMessage('❌ Bağlantı hatası: ' + err);
    });
  });

  peer.on('error', (err) => {
    console.error('Peer hatası:', err);
    setScanStatus('Bağlantı hatası: ' + err.type, 'error');
  });
}

// ---------- Elle ID girme ----------
document.getElementById('manual-toggle').addEventListener('click', () => {
  document.getElementById('manual-box').classList.toggle('hidden');
});

document.getElementById('manual-connect').addEventListener('click', () => {
  let id = document.getElementById('manual-id').value.trim();
  if (!id) return;
  // Elle girilen ID'de de p2p:// şeması varsa temizle
  if (id.startsWith('p2p://')) id = id.slice('p2p://'.length);
  stopScanner().then(() => connectToPeer(id));
});

// ---------- Başlat ----------
window.addEventListener('load', () => {
  startScanner();
});