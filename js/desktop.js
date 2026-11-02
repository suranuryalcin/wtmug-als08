/* ============================================================
   ALŞ08 — Web Arayüzü (Bilgisayar)
   Peer oluştur → ID al → QR kod üret → mobil bağlantıyı bekle
   ============================================================ */

let peer = null;
let conn = null;

const statusEl = document.getElementById('connect-status');
const peerIdEl = document.getElementById('peer-id-display');
const qrContainer = document.getElementById('qrcode');
const qrLoading = document.getElementById('qr-loading');

function setStatus(msg, cls = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

// ---------- Peer başlat ----------
function initPeer() {
  peer = new Peer(undefined, {
    debug: 1
    // PeerJS genel bulut sunucusu kullanılır (ücretsiz)
  });

  peer.on('open', (id) => {
    console.log('Peer ID:', id);
    peerIdEl.textContent = id;
    setStatus('Bağlantıya hazır. QR kodu telefonla okutun.', 'ok');

    // QR kod oluştur — p2p:// şemasıyla
    qrLoading.style.display = 'none';
    qrContainer.innerHTML = '';
    const qrPayload = 'p2p://' + id;
    new QRCode(qrContainer, {
      text: qrPayload,
      width: 240,
      height: 240,
      correctLevel: QRCode.CorrectLevel.M
    });
  });

  peer.on('error', (err) => {
    console.error('Peer hatası:', err);
    setStatus('Hata: ' + err.type, 'error');
  });

  peer.on('connection', (incoming) => {
    console.log('Gelen bağlantı:', incoming.peer);

    // Tek bağlantı kilidi
    if (conn && conn.open) {
      console.warn('Zaten açık bağlantı var, yeni bağlantı reddedildi:', incoming.peer);
      incoming.close();
      return;
    }

    conn = incoming;

    conn.on('open', () => {
      console.log('DataChannel açıldı');
      switchToChat();
      bindChatEvents(conn, () => conn);
      addSystemMessage('📱 Telefon bağlandı.');
      const label = document.getElementById('peer-label');
      if (label) label.textContent = conn.peer;
    });

    conn.on('data', (data) => {
      // Önce dosya protokolü kontrolü, sonra metin
      const handled = handleIncomingData(data, conn);
      if (!handled) {
        if (typeof data === 'string') addMessage(data, 'theirs');
      }
    });

    conn.on('close', () => {
      addSystemMessage('🔌 Bağlantı kapandı.');
      setStatus('Bağlantı kapandı.', 'error');
    });

    conn.on('error', (err) => {
      console.error('Conn hatası:', err);
      addSystemMessage('❌ Bağlantı hatası: ' + err);
    });
  });
}

// ---------- ID kopyala ----------
document.getElementById('copy-id-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(peerIdEl.textContent);
    document.getElementById('copy-id-btn').textContent = '✅';
    setTimeout(() => { document.getElementById('copy-id-btn').textContent = '📋'; }, 1200);
  } catch (e) {
    alert('Kopyalanamadı: ' + peerIdEl.textContent);
  }
});

// ---------- Başlat ----------
window.addEventListener('load', initPeer);