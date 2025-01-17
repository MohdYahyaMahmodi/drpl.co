/*************************************************************
 * main.js
 * 
 * 1) Peer discovery & basic messaging
 * 2) "transfer-cancel" for real-time cancel
 * 3) File transfer:
 *    - Drag-and-drop in a "Send Files" modal
 *    - Chunk-based file sending with base64
 *    - "Receiving Files" modal with progress
 *    - Preview modal with left/right navigation + downloads
 *************************************************************/

// A chunk size for splitting files
const CHUNK_SIZE = 64 * 1024; // 64 KB chunk

function detectDeviceType() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/(iphone|ipod|android.*mobile|webos|blackberry)/.test(userAgent)) {
    return 'mobile';
  } else if (/(ipad|android(?!.*mobile))/.test(userAgent)) {
    return 'tablet';
  } else if (/(macintosh|windows|linux)/.test(userAgent)) {
    return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
  }
  return 'desktop'; 
}

class ServerConnection {
  constructor(deviceType) {
    this.id = null;
    this.socket = null;
    this.deviceType = deviceType;
    this.displayName = '';
    this.connect();
  }

  connect() {
    const protocol = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    const endpoint = protocol + location.host;
    console.log('[ServerConnection] Attempting to connect:', endpoint);

    this.socket = new WebSocket(endpoint);

    this.socket.onopen = () => {
      console.log('[ServerConnection] WebSocket open');
      this.send({ type: 'introduce', name: { deviceType: this.deviceType } });
    };

    this.socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      this.handleMessage(data);
    };

    this.socket.onclose = () => {
      console.log('[ServerConnection] WebSocket closed');
      // Show "Server Disconnected" modal
      const serverModal = document.getElementById('server-disconnected-modal');
      if (serverModal) {
        serverModal.style.display = 'flex';
      }
    };

    this.socket.onerror = (err) => {
      console.error('[ServerConnection] WebSocket error:', err);
    };
  }

  send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  handleMessage(msg) {
    console.log('[ServerConnection] Received message:', msg);

    switch (msg.type) {
      case 'display-name': {
        this.id = msg.message.peerId;
        this.displayName = msg.message.displayName;
        const deviceNameElem = document.getElementById('device-name');
        if (deviceNameElem) deviceNameElem.textContent = this.displayName;
        break;
      }
      case 'peers':
        window.dispatchEvent(new CustomEvent('peers', { detail: msg.peers }));
        break;
      case 'peer-joined':
        window.dispatchEvent(new CustomEvent('peer-joined', { detail: msg.peer }));
        break;
      case 'peer-left':
        window.dispatchEvent(new CustomEvent('peer-left', { detail: msg.peerId }));
        break;
      case 'peer-updated':
        window.dispatchEvent(new CustomEvent('peer-updated', { detail: msg.peer }));
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;

      /************************************************
       * Transfer & Messaging
       ************************************************/
      case 'transfer-request':
        window.dispatchEvent(new CustomEvent('transfer-request', { detail: msg }));
        break;
      case 'transfer-accept':
        window.dispatchEvent(new CustomEvent('transfer-accept', { detail: msg }));
        break;
      case 'transfer-decline':
        window.dispatchEvent(new CustomEvent('transfer-decline', { detail: msg }));
        break;
      case 'transfer-cancel':
        window.dispatchEvent(new CustomEvent('transfer-cancel', { detail: msg }));
        break;

      case 'send-message':
        window.dispatchEvent(new CustomEvent('incoming-message', { detail: msg }));
        break;
      case 'transfer-complete':
        window.dispatchEvent(new CustomEvent('transfer-complete', { detail: msg }));
        break;
      case 'transfer-error':
        window.dispatchEvent(new CustomEvent('transfer-error', { detail: msg }));
        break;

      // For file-chunk-based messages:
      case 'files-begin':
        window.dispatchEvent(new CustomEvent('files-begin', { detail: msg }));
        break;
      case 'file-info':
        window.dispatchEvent(new CustomEvent('file-info', { detail: msg }));
        break;
      case 'file-chunk':
        window.dispatchEvent(new CustomEvent('file-chunk', { detail: msg }));
        break;

      default:
        console.log('[ServerConnection] Unknown message type:', msg.type);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let peers = {};
  let currentRecipientId = null;
  let currentRequesterId = null;
  let currentMode = null; // "files" or "message"
  const autoAcceptMap = {};

  const deviceType = detectDeviceType();
  const serverConnection = new ServerConnection(deviceType);

  // Basic references
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  // Choose Action
  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionDeviceName = document.getElementById('choose-action-device-name');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMessageBtn = document.getElementById('choose-action-send-message');

  // Incoming Request
  const incomingRequestModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingRequestText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');
  const alwaysAcceptCheckbox = document.getElementById('always-accept-checkbox');

  // Waiting for Response
  const waitingResponseModal = document.getElementById('waiting-response-modal');
  const waitingResponseBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingResponseText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  // Receiving Status
  const receivingStatusModal = document.getElementById('receiving-status-modal');
  const receivingStatusBackdrop = document.getElementById('receiving-status-backdrop');
  const receivingStatusText = document.getElementById('receiving-status-text');

  // Send Message
  const sendMessageModal = document.getElementById('send-message-modal');
  const sendMessageBackdrop = document.getElementById('send-message-backdrop');
  const sendMessageCancel = document.getElementById('send-message-cancel');
  const sendMessageBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  // Incoming Message
  const incomingMessageModal = document.getElementById('incoming-message-modal');
  const incomingMessageBackdrop = document.getElementById('incoming-message-backdrop');
  const incomingMessageHeader = document.getElementById('incoming-message-header');
  const incomingMessageText = document.getElementById('incoming-message-text');
  const incomingMessageClose = document.getElementById('incoming-message-close');
  const incomingMessageRespond = document.getElementById('incoming-message-respond');

  // Transfer Complete
  const transferCompleteModal = document.getElementById('transfer-complete-modal');
  const transferCompleteBackdrop = document.getElementById('transfer-complete-backdrop');
  const transferCompleteTitle = document.getElementById('transfer-complete-title');
  const transferCompleteText = document.getElementById('transfer-complete-text');
  const transferCompleteClose = document.getElementById('transfer-complete-close');

  // Peer Lost, Server Disconnected
  const peerLostModal = document.getElementById('peer-lost-modal');
  const peerLostBackdrop = document.getElementById('peer-lost-backdrop');
  const peerLostClose = document.getElementById('peer-lost-close');

  const serverDisconnectedModal = document.getElementById('server-disconnected-modal');
  const serverDisconnectedClose = document.getElementById('server-disconnected-close');

  // Info & Author
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModal = document.getElementById('author-modal');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  /***********************************************************
   * Additional File Transfer UI references
   **********************************************************/
  const sendFilesModal = document.getElementById('send-files-modal');
  const sendFilesBackdrop = document.getElementById('send-files-backdrop');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const selectedFilesList = document.getElementById('selected-files-list');
  const sendFilesCancel = document.getElementById('send-files-cancel');
  const sendFilesButton = document.getElementById('send-files-button');

  const receivingFilesModal = document.getElementById('receiving-files-modal');
  const receivingFilesBackdrop = document.getElementById('receiving-files-backdrop');
  const receivingProgressText = document.getElementById('receiving-progress-text');
  const receivingProgressBar = document.getElementById('receiving-progress-bar').children[0];
  const receivingFilename = document.getElementById('receiving-filename');

  const filePreviewModal = document.getElementById('file-preview-modal');
  const filePreviewBackdrop = document.getElementById('file-preview-backdrop');
  const filePreviewDisplay = document.getElementById('file-preview-display');
  const filePreviewPrev = document.getElementById('file-preview-prev');
  const filePreviewNext = document.getElementById('file-preview-next');
  const fileDownloadButton = document.getElementById('file-download-button');
  const fileDownloadAllButton = document.getElementById('file-download-all-button');
  const filePreviewClose = document.getElementById('file-preview-close');

  // Utility: close all modals
  function closeAllModals() {
    [
      chooseActionModal, 
      incomingRequestModal, 
      waitingResponseModal, 
      receivingStatusModal, 
      sendMessageModal, 
      incomingMessageModal, 
      transferCompleteModal,
      sendFilesModal,
      receivingFilesModal,
      filePreviewModal
    ].forEach(m => { if (m) m.style.display = 'none'; });
  }

  /***********************************************************
   * Update Peer List
   **********************************************************/
  function updatePeerList() {
    peerListElement.innerHTML = '';
    const peerIds = Object.keys(peers);
    noPeersMessage.style.display = (peerIds.length === 0) ? 'block' : 'none';

    peerIds.forEach(pid => {
      const peer = peers[pid];
      const btn = document.createElement('button');
      btn.className = 'peer-button w-full py-[15px] text-xl bg-[#333533] text-white rounded-lg hover:bg-[#242423] transition-colors';

      const iconEl = document.createElement('i');
      iconEl.classList.add('fas', getDeviceIcon(peer.name.type), 'peer-device-icon', 'text-white');
      const textSpan = document.createElement('span');
      textSpan.textContent = peer.name.displayName;

      btn.appendChild(iconEl);
      btn.appendChild(textSpan);

      btn.addEventListener('click', () => {
        currentRecipientId = peer.id;
        chooseActionDeviceName.textContent = `Send to ${peer.name.displayName}`;
        chooseActionModal.style.display = 'flex';
      });

      peerListElement.appendChild(btn);
    });
  }

  function getDeviceIcon(type) {
    switch (type) {
      case 'mobile':  return 'fa-mobile-alt';
      case 'tablet':  return 'fa-tablet-alt';
      case 'laptop':
      case 'desktop': return 'fa-desktop';
      default:        return 'fa-question-circle';
    }
  }

  /***********************************************************
   * Basic Flow: Transfer Request
   **********************************************************/
  function sendTransferRequest(mode) {
    if (!currentRecipientId) return;
    currentMode = mode;

    const peerName = peers[currentRecipientId]?.name?.displayName || 'Unknown';
    waitingResponseText.textContent = `Waiting for ${peerName} to accept...`;
    waitingResponseModal.style.display = 'flex';

    serverConnection.send({
      type: 'transfer-request',
      to: currentRecipientId,
      fromDisplayName: serverConnection.displayName,
      mode
    });
  }

  /***********************************************************
   * Cancel from Sender
   **********************************************************/
  function cancelSenderFlow() {
    if (currentRecipientId) {
      serverConnection.send({ type: 'transfer-cancel', to: currentRecipientId });
    }
    closeAllModals();
    currentRecipientId = null;
    currentMode = null;
  }

  /***********************************************************
   * Show/hide receiving status
   **********************************************************/
  function showReceivingStatus(senderName, mode) {
    receivingStatusText.textContent = `Waiting for ${senderName} to send ${mode === 'files' ? 'files' : 'a message'}...`;
    receivingStatusModal.style.display = 'flex';
  }
  function hideReceivingStatus() {
    receivingStatusModal.style.display = 'none';
  }

  /***********************************************************
   * LISTEN FOR SERVER EVENTS
   **********************************************************/
  // (We keep the previously shown snippet logic: transfer-request, etc.)

  window.addEventListener('transfer-request', (e) => {
    const msg = e.detail;
    currentRequesterId = msg.sender;
    currentMode = msg.mode;
    closeAllModals();

    const fromName = msg.fromDisplayName || 'Unknown';
    if (autoAcceptMap[currentRequesterId]) {
      // auto-accept
      serverConnection.send({ type: 'transfer-accept', to: currentRequesterId, mode: currentMode });
      showReceivingStatus(fromName, currentMode);
      return;
    }

    incomingRequestText.textContent = `${fromName} wants to send ${currentMode === 'files' ? 'files' : 'a message'}.`;
    incomingRequestModal.style.display = 'flex';
    alwaysAcceptCheckbox.checked = false;
  });

  incomingDeclineBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });
  incomingAcceptBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      if (alwaysAcceptCheckbox.checked) {
        autoAcceptMap[currentRequesterId] = true;
      }
      serverConnection.send({ type: 'transfer-accept', to: currentRequesterId, mode: currentMode });
      const fromName = peers[currentRequesterId]?.name?.displayName || 'Unknown';
      showReceivingStatus(fromName, currentMode);
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
  });

  window.addEventListener('transfer-accept', (e) => {
    const msg = e.detail;
    waitingResponseModal.style.display = 'none';
    currentRecipientId = msg.sender;
    if (msg.mode === 'files') {
      // Show the send-files modal
      sendFilesModal.style.display = 'flex';
      pendingFiles = [];
      updateSelectedFilesList();
    } else if (msg.mode === 'message') {
      sendMessageModal.style.display = 'flex';
    }
  });

  window.addEventListener('transfer-decline', (e) => {
    waitingResponseModal.style.display = 'none';
    alert('They declined the transfer.');
    currentRecipientId = null;
    currentMode = null;
  });

  window.addEventListener('transfer-cancel', (e) => {
    closeAllModals();
    alert('The other device canceled the transfer.');
    currentRecipientId = null;
    currentRequesterId = null;
    currentMode = null;
  });

  /***********************************************************
   * WAITING CANCEL
   **********************************************************/
  waitingResponseBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
  });
  waitingCancelBtn.addEventListener('click', () => {
    cancelSenderFlow();
  });

  // incoming backdrop => decline
  incomingBackdrop.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  /***********************************************************
   * Send Message
   **********************************************************/
  sendMessageBtn.addEventListener('click', () => {
    if (!currentRecipientId) return;
    const text = messageInput.value.trim();
    if (!text) return;
    serverConnection.send({
      type: 'send-message',
      to: currentRecipientId,
      text,
      fromName: serverConnection.displayName
    });
    sendMessageModal.style.display = 'none';
    messageInput.value = '';
  });
  sendMessageCancel.addEventListener('click', () => {
    cancelSenderFlow();
    messageInput.value = '';
  });
  sendMessageBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
    messageInput.value = '';
  });

  window.addEventListener('incoming-message', (e) => {
    hideReceivingStatus();

    const msg = e.detail;
    const fromName = msg.fromName || 'Unknown';
    currentRequesterId = msg.sender;
    incomingMessageHeader.textContent = `Message from ${fromName}`;
    incomingMessageText.textContent = msg.text || '';
    incomingMessageModal.style.display = 'flex';

    // Acknowledge => "transfer-complete"
    serverConnection.send({
      type: 'transfer-complete',
      to: msg.sender,
      status: 'ok',
      fromName: serverConnection.displayName
    });
  });
  incomingMessageClose.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
    currentRequesterId = null;
  });
  incomingMessageBackdrop.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
  });

  incomingMessageRespond.addEventListener('click', () => {
    currentRecipientId = currentRequesterId;
    currentRequesterId = null;
    incomingMessageModal.style.display = 'none';
    sendMessageModal.style.display = 'flex';
  });

  /***********************************************************
   * TRANSFER COMPLETE
   **********************************************************/
  window.addEventListener('transfer-complete', (e) => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Complete';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `Your message has been delivered to ${fromName}.`;
    transferCompleteModal.style.display = 'flex';
  });
  window.addEventListener('transfer-error', (e) => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Error';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `There was an error sending to ${fromName}. Please try again.`;
    transferCompleteModal.style.display = 'flex';
  });
  transferCompleteBackdrop.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });
  transferCompleteClose.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });

  /***********************************************************
   * CHOOSE ACTION
   **********************************************************/
  chooseActionSendFilesBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    sendTransferRequest('files');
  });
  chooseActionSendMessageBtn.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
    sendTransferRequest('message');
  });
  chooseActionBackdrop.addEventListener('click', () => {
    chooseActionModal.style.display = 'none';
  });

  /***********************************************************
   * Info & Author modals
   **********************************************************/
  infoButton.addEventListener('click', () => {
    infoModal.style.display = 'flex';
  });
  infoModalClose.addEventListener('click', () => {
    infoModal.style.display = 'none';
  });
  infoModalBackdrop.addEventListener('click', () => {
    infoModal.style.display = 'none';
  });

  authorButton.addEventListener('click', () => {
    authorModal.style.display = 'flex';
  });
  authorModalClose.addEventListener('click', () => {
    authorModal.style.display = 'none';
  });
  authorModalBackdrop.addEventListener('click', () => {
    authorModal.style.display = 'none';
  });

  /***********************************************************
   * FILE SENDING UI
   **********************************************************/
  let pendingFiles = []; // array of { file, name }

  function updateSelectedFilesList() {
    selectedFilesList.innerHTML = '';
    pendingFiles.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'file-item';
      const span = document.createElement('span');
      span.className = 'file-name';
      span.textContent = item.name;

      const removeIcon = document.createElement('i');
      removeIcon.className = 'fas fa-trash-alt';
      removeIcon.style.marginLeft = '8px';
      removeIcon.addEventListener('click', () => {
        pendingFiles.splice(i, 1);
        updateSelectedFilesList();
      });

      div.appendChild(span);
      div.appendChild(removeIcon);
      selectedFilesList.appendChild(div);
    });
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500');
    if (e.dataTransfer.files?.length) {
      Array.from(e.dataTransfer.files).forEach((f) => {
        pendingFiles.push({ file: f, name: f.name });
      });
      updateSelectedFilesList();
    }
  });
  fileInput.addEventListener('change', (e) => {
    Array.from(e.target.files).forEach((f) => {
      pendingFiles.push({ file: f, name: f.name });
    });
    updateSelectedFilesList();
  });

  sendFilesCancel.addEventListener('click', () => {
    cancelSenderFlow();
  });
  sendFilesBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
  });

  // On "Send"
  sendFilesButton.addEventListener('click', async () => {
    if (!currentRecipientId || pendingFiles.length === 0) return;

    // We'll send a "files-begin" message first
    serverConnection.send({
      type: 'files-begin',
      to: currentRecipientId,
      count: pendingFiles.length
    });

    // Then chunk each file
    for (let i = 0; i < pendingFiles.length; i++) {
      const { file, name } = pendingFiles[i];

      // file-info
      serverConnection.send({
        type: 'file-info',
        to: currentRecipientId,
        filename: name,
        fileSize: file.size,
        index: i,
        total: pendingFiles.length
      });

      let offset = 0;
      while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();
        const b64 = arrayBufferToBase64(arrayBuffer);
        serverConnection.send({
          type: 'file-chunk',
          to: currentRecipientId,
          index: i,
          chunk: b64,
          done: (offset + CHUNK_SIZE >= file.size)
        });
        offset += CHUNK_SIZE;
      }
    }

    // close the modal
    sendFilesModal.style.display = 'none';
    pendingFiles = [];
  });

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /***********************************************************
   * RECEIVING FILES
   **********************************************************/
  let receivingFiles = []; // array of { name, size, received, data: Uint8Array }
  let currentFileIndex = 0;
  let totalFiles = 0;

  window.addEventListener('files-begin', (e) => {
    const msg = e.detail;
    totalFiles = msg.count;
    receivingFiles = [];
    currentFileIndex = 0;

    receivingFilesModal.style.display = 'flex';
    receivingProgressText.textContent = `File 0/${totalFiles}`;
    receivingProgressBar.style.width = '0%';
    receivingFilename.textContent = '';
  });
  window.addEventListener('file-info', (e) => {
    const msg = e.detail;
    const { filename, fileSize, index, total } = msg;
    receivingFiles[index] = {
      name: filename,
      size: fileSize,
      received: 0,
      data: new Uint8Array(fileSize)
    };
    if (index === 0) {
      currentFileIndex = 0;
      receivingProgressText.textContent = `File 1/${totalFiles}`;
      receivingFilename.textContent = filename;
    }
  });
  window.addEventListener('file-chunk', (e) => {
    const msg = e.detail;
    const { index, chunk, done } = msg;

    const chunkBytes = base64ToUint8Array(chunk);
    const fileObj = receivingFiles[index];
    if (!fileObj) return;
    fileObj.data.set(chunkBytes, fileObj.received);
    fileObj.received += chunkBytes.length;

    if (index === currentFileIndex) {
      const pct = (fileObj.received / fileObj.size) * 100;
      receivingProgressBar.style.width = pct.toFixed(1) + '%';
    }

    if (done) {
      if (index === currentFileIndex) {
        currentFileIndex++;
        if (currentFileIndex < totalFiles) {
          receivingProgressText.textContent = `File ${currentFileIndex + 1}/${totalFiles}`;
          receivingFilename.textContent = receivingFiles[currentFileIndex]?.name || '';
          receivingProgressBar.style.width = '0%';
        } else {
          // all done
          receivingFilesModal.style.display = 'none';
          finalizeFileReceiving();
        }
      }
    }
  });

  function base64ToUint8Array(b64) {
    const binary = window.atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Once all files are received => show preview
  let receivedFileList = [];
  function finalizeFileReceiving() {
    // create an array of { name, blob }
    receivedFileList = receivingFiles.map((f) => {
      return { name: f.name, blob: new Blob([f.data]) };
    });
    currentPreviewIndex = 0;
    filePreviewModal.style.display = 'flex';
    showPreviewFile(0);
  }

  receivingFilesBackdrop.addEventListener('click', () => {
    // optional: allow receiver to cancel
  });

  /***********************************************************
   * FILE PREVIEW
   **********************************************************/
  let currentPreviewIndex = 0;

  function showPreviewFile(index) {
    if (!receivedFileList[index]) return;
    const { name, blob } = receivedFileList[index];
    filePreviewDisplay.innerHTML = '';
    const mime = getMimeType(name);
    if (mime.startsWith('image/')) {
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = url;
      img.className = 'max-h-full max-w-full';
      filePreviewDisplay.appendChild(img);
    } else {
      // show generic file icon
      const icon = document.createElement('i');
      icon.className = 'fas fa-file fa-3x';
      const p = document.createElement('p');
      p.textContent = name;
      filePreviewDisplay.appendChild(icon);
      filePreviewDisplay.appendChild(p);
    }
  }

  filePreviewPrev.addEventListener('click', () => {
    if (currentPreviewIndex > 0) {
      currentPreviewIndex--;
      showPreviewFile(currentPreviewIndex);
    }
  });
  filePreviewNext.addEventListener('click', () => {
    if (currentPreviewIndex < receivedFileList.length - 1) {
      currentPreviewIndex++;
      showPreviewFile(currentPreviewIndex);
    }
  });

  filePreviewClose.addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
  });
  filePreviewBackdrop.addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
  });

  fileDownloadButton.addEventListener('click', () => {
    const { name, blob } = receivedFileList[currentPreviewIndex];
    downloadBlob(blob, name);
  });
  fileDownloadAllButton.addEventListener('click', () => {
    // In production, you might zip them all. Here we do each individually:
    receivedFileList.forEach((f) => {
      downloadBlob(f.blob, f.name);
    });
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      return 'image/' + ext;
    }
    // fallback
    return 'application/octet-stream';
  }
});
