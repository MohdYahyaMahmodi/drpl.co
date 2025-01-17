/*************************************************************
 * main.js
 *
 * Major Features:
 *  - Peer discovery
 *  - Transfer requests (files/messages)
 *  - Chunk-based file sending over WebSockets
 *  - Progress bars for receiving
 *  - Slideshow preview and downloads
 *  - Extended keep-alive; reduced chunk size for large files
 *************************************************************/

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
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
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

      // The chunk-based file messages:
      case 'file-chunk':
        window.dispatchEvent(new CustomEvent('file-chunk', { detail: msg }));
        break;
      case 'file-transfer-init':
        window.dispatchEvent(new CustomEvent('file-transfer-init', { detail: msg }));
        break;
      case 'file-transfer-complete':
        window.dispatchEvent(new CustomEvent('file-transfer-finished', { detail: msg }));
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

  // TODO: [Optional] Implement WebRTC data channels here if you wish.
  // This would involve exchanging offers/answers/ICE candidates over
  // the serverConnection and then using the data channel to transfer
  // large files directly (LAN peer-to-peer).

  // Grab references to modals/elements
  const peerListElement = document.getElementById('peer-list');
  const noPeersMessage = document.getElementById('no-peers-message');

  const chooseActionModal = document.getElementById('choose-action-modal');
  const chooseActionBackdrop = document.getElementById('choose-action-backdrop');
  const chooseActionDeviceName = document.getElementById('choose-action-device-name');
  const chooseActionSendFilesBtn = document.getElementById('choose-action-send-files');
  const chooseActionSendMessageBtn = document.getElementById('choose-action-send-message');

  const incomingRequestModal = document.getElementById('incoming-request-modal');
  const incomingBackdrop = document.getElementById('incoming-request-backdrop');
  const incomingRequestText = document.getElementById('incoming-request-text');
  const incomingDeclineBtn = document.getElementById('incoming-decline-button');
  const incomingAcceptBtn = document.getElementById('incoming-accept-button');
  const alwaysAcceptCheckbox = document.getElementById('always-accept-checkbox');

  const waitingResponseModal = document.getElementById('waiting-response-modal');
  const waitingResponseBackdrop = document.getElementById('waiting-response-backdrop');
  const waitingResponseText = document.getElementById('waiting-response-text');
  const waitingCancelBtn = document.getElementById('waiting-cancel-button');

  const receivingStatusModal = document.getElementById('receiving-status-modal');
  const receivingStatusBackdrop = document.getElementById('receiving-status-backdrop');
  const receivingStatusText = document.getElementById('receiving-status-text');

  const sendMessageModal = document.getElementById('send-message-modal');
  const sendMessageBackdrop = document.getElementById('send-message-backdrop');
  const sendMessageCancel = document.getElementById('send-message-cancel');
  const sendMessageBtn = document.getElementById('send-message-button');
  const messageInput = document.getElementById('message-input');

  const incomingMessageModal = document.getElementById('incoming-message-modal');
  const incomingMessageBackdrop = document.getElementById('incoming-message-backdrop');
  const incomingMessageHeader = document.getElementById('incoming-message-header');
  const incomingMessageText = document.getElementById('incoming-message-text');
  const incomingMessageClose = document.getElementById('incoming-message-close');
  const incomingMessageRespond = document.getElementById('incoming-message-respond');

  const transferCompleteModal = document.getElementById('transfer-complete-modal');
  const transferCompleteBackdrop = document.getElementById('transfer-complete-backdrop');
  const transferCompleteTitle = document.getElementById('transfer-complete-title');
  const transferCompleteText = document.getElementById('transfer-complete-text');
  const transferCompleteClose = document.getElementById('transfer-complete-close');

  const peerLostModal = document.getElementById('peer-lost-modal');
  const peerLostBackdrop = document.getElementById('peer-lost-backdrop');
  const peerLostClose = document.getElementById('peer-lost-close');

  const serverDisconnectedModal = document.getElementById('server-disconnected-modal');
  const serverDisconnectedClose = document.getElementById('server-disconnected-close');

  // Info & Author modals
  const infoButton = document.getElementById('info-button');
  const authorButton = document.getElementById('author-button');
  const infoModal = document.getElementById('info-modal');
  const infoModalClose = document.getElementById('info-modal-close');
  const infoModalBackdrop = document.getElementById('info-modal-backdrop');
  const authorModal = document.getElementById('author-modal');
  const authorModalClose = document.getElementById('author-modal-close');
  const authorModalBackdrop = document.getElementById('author-modal-backdrop');

  // ========== FILE TRANSFER MODALS ==========
  const sendFilesModal = document.getElementById('send-files-modal');
  const sendFilesBackdrop = document.getElementById('send-files-backdrop');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const selectedFilesContainer = document.getElementById('selected-files-container');
  const sendFilesCancelBtn = document.getElementById('send-files-cancel');
  const startFileTransferBtn = document.getElementById('start-file-transfer');

  const receivingFilesModal = document.getElementById('receiving-files-modal');
  const receivingFilesBackdrop = document.getElementById('receiving-files-backdrop');
  const fileProgressList = document.getElementById('file-progress-list');

  const filePreviewModal = document.getElementById('file-preview-modal');
  const filePreviewBackdrop = document.getElementById('file-preview-backdrop');
  const filePreviewClose = document.getElementById('file-preview-close');
  const filePreviewContent = document.getElementById('file-preview-content');
  const prevFileBtn = document.getElementById('prev-file-btn');
  const nextFileBtn = document.getElementById('next-file-btn');
  const downloadCurrentFileBtn = document.getElementById('download-current-file');
  const downloadAllFilesBtn = document.getElementById('download-all-files');

  // State for file-sending
  let selectedFiles = [];
  let sendingInProgress = false;

  // State for file-receiving
  let receivingFiles = [];
  let receivingFilesInfo = []; // { name, size, dataChunks[] }
  let currentFileIndex = 0; // for preview slideshow

  // Utility to close all modals (except needed ones)
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
    ].forEach(m => (m.style.display = 'none'));
  }

  // Update Peer List
  function updatePeerList() {
    peerListElement.innerHTML = '';
    const peerIds = Object.keys(peers);

    if (peerIds.length === 0) {
      noPeersMessage.style.display = 'block';
    } else {
      noPeersMessage.style.display = 'none';
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
   * SERVER EVENT HANDLERS
   **********************************************************/
  window.addEventListener('peers', e => {
    peers = {};
    e.detail.forEach(p => {
      if (p.id !== serverConnection.id) {
        peers[p.id] = p;
      }
    });
    updatePeerList();
  });

  window.addEventListener('peer-joined', e => {
    const newPeer = e.detail;
    if (newPeer.id !== serverConnection.id) {
      peers[newPeer.id] = newPeer;
      updatePeerList();
    }
  });

  window.addEventListener('peer-left', e => {
    const peerId = e.detail;
    if (peers[peerId]) {
      delete peers[peerId];
      updatePeerList();
    }
    // If we are in the middle of a flow with that peer, close everything and show "Peer Lost"
    if (peerId === currentRecipientId || peerId === currentRequesterId) {
      closeAllModals();
      peerLostModal.style.display = 'flex';
      currentRecipientId = null;
      currentRequesterId = null;
      currentMode = null;
      selectedFiles = [];
      receivingFiles = [];
    }
  });

  window.addEventListener('peer-updated', e => {
    const updatedPeer = e.detail;
    peers[updatedPeer.id] = updatedPeer;
    updatePeerList();
  });

  /***********************************************************
   * TRANSFER FLOW
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

  // On receiving side
  window.addEventListener('transfer-request', e => {
    const msg = e.detail;
    const fromName = msg.fromDisplayName || 'Unknown';
    currentRequesterId = msg.sender;
    currentMode = msg.mode;

    // If we already have a flow, let's close out everything
    closeAllModals();

    if (autoAcceptMap[currentRequesterId]) {
      // auto-accept
      serverConnection.send({
        type: 'transfer-accept',
        to: currentRequesterId,
        mode: currentMode
      });
      showReceivingStatus(fromName, currentMode);
      return;
    }

    incomingRequestText.textContent = `${fromName} wants to send ${
      currentMode === 'files' ? 'files' : 'a message'
    }.`;
    incomingRequestModal.style.display = 'flex';
    alwaysAcceptCheckbox.checked = false;
  });

  // On the receiving side => user clicks decline
  incomingDeclineBtn.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  // On the receiving side => user clicks accept
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

  // On the sender side => sees accept
  window.addEventListener('transfer-accept', e => {
    const msg = e.detail;
    // Hide the "Waiting" modal
    waitingResponseModal.style.display = 'none';

    // The peer who accepted
    currentRecipientId = msg.sender;
    if (msg.mode === 'files') {
      // Show the "Send Files" modal (if not already open)
      sendFilesModal.style.display = 'flex';
    } else if (msg.mode === 'message') {
      sendMessageModal.style.display = 'flex';
    }
  });

  // On the sender side => sees decline
  window.addEventListener('transfer-decline', e => {
    waitingResponseModal.style.display = 'none';
    alert('They declined the transfer.');
    currentRecipientId = null;
    currentMode = null;
  });

  // On either side => sees "transfer-cancel"
  window.addEventListener('transfer-cancel', e => {
    closeAllModals();
    alert('The other device canceled the transfer.');
    currentRecipientId = null;
    currentRequesterId = null;
    currentMode = null;
    selectedFiles = [];
    receivingFiles = [];
  });

  // CANCEL FROM SENDER => send "transfer-cancel" to the peer
  function cancelSenderFlow() {
    if (currentRecipientId) {
      serverConnection.send({ type: 'transfer-cancel', to: currentRecipientId });
    }
    closeAllModals();
    currentRecipientId = null;
    currentMode = null;
    selectedFiles = [];
    sendingInProgress = false;
  }

  /***********************************************************
   * "Receiving Status" (Receiver side)
   **********************************************************/
  function showReceivingStatus(senderName, mode) {
    receivingStatusText.textContent = `Waiting for ${senderName} to send ${
      mode === 'files' ? 'files' : 'a message'
    }...`;
    receivingStatusModal.style.display = 'flex';
  }
  function hideReceivingStatus() {
    receivingStatusModal.style.display = 'none';
  }

  /***********************************************************
   * SEND MESSAGE FLOW (sender side)
   **********************************************************/
  sendMessageBtn.addEventListener('click', () => {
    if (!currentRecipientId) return;
    const text = messageInput.value.trim();
    if (!text) {
      return;
    }
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
    // Cancel => tell the receiver
    cancelSenderFlow();
    messageInput.value = '';
  });

  /***********************************************************
   * INCOMING MESSAGE (receiver side)
   **********************************************************/
  window.addEventListener('incoming-message', e => {
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

  incomingMessageRespond.addEventListener('click', () => {
    currentRecipientId = currentRequesterId;
    currentRequesterId = null;
    incomingMessageModal.style.display = 'none';
    sendMessageModal.style.display = 'flex';
  });

  /***********************************************************
   * TRANSFER COMPLETE (sender side)
   **********************************************************/
  window.addEventListener('transfer-complete', e => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Complete';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `Your message has been delivered to ${fromName}.`;
    transferCompleteModal.style.display = 'flex';
  });

  window.addEventListener('transfer-error', e => {
    const msg = e.detail;
    transferCompleteTitle.textContent = 'Transfer Error';
    const fromName = msg.fromName || 'the receiver';
    transferCompleteText.textContent = `There was an error sending to ${fromName}. Please try again.`;
    transferCompleteModal.style.display = 'flex';
  });

  /***********************************************************
   * CANCEL FROM WAITING / SENDER
   **********************************************************/
  waitingResponseBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
  });
  waitingCancelBtn.addEventListener('click', () => {
    cancelSenderFlow();
  });

  /***********************************************************
   * CHOOSE ACTION MODAL
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
   * BACKDROP CLICKS & CANCELS
   **********************************************************/
  // Incoming request backdrop => decline
  incomingBackdrop.addEventListener('click', () => {
    if (currentRequesterId) {
      serverConnection.send({ type: 'transfer-decline', to: currentRequesterId });
    }
    incomingRequestModal.style.display = 'none';
    currentRequesterId = null;
    currentMode = null;
  });

  // receivingStatusBackdrop => (Optionally implement a “Cancel receiving”?)

  // If the user clicks the black backdrop on the send-message modal => cancel
  sendMessageBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
    messageInput.value = '';
  });

  // incoming-message-backdrop => just close
  incomingMessageBackdrop.addEventListener('click', () => {
    incomingMessageModal.style.display = 'none';
  });

  // transferCompleteBackdrop => close
  transferCompleteBackdrop.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });
  transferCompleteClose.addEventListener('click', () => {
    transferCompleteModal.style.display = 'none';
  });

  // peerLostBackdrop => close
  peerLostBackdrop.addEventListener('click', () => {
    peerLostModal.style.display = 'none';
  });
  peerLostClose.addEventListener('click', () => {
    peerLostModal.style.display = 'none';
  });

  // serverDisconnectedClose => close
  serverDisconnectedClose.addEventListener('click', () => {
    serverDisconnectedModal.style.display = 'none';
  });

  // ========== FILE SENDING HANDLERS ==========
  sendFilesBackdrop.addEventListener('click', () => {
    cancelSenderFlow();
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('bg-gray-100');
  });
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-gray-100');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleSelectedFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    handleSelectedFiles(e.target.files);
  });

  function handleSelectedFiles(fileList) {
    for (const file of fileList) {
      selectedFiles.push(file);
    }
    renderSelectedFiles();
  }

  function renderSelectedFiles() {
    selectedFilesContainer.innerHTML = '';
    if (selectedFiles.length === 0) {
      startFileTransferBtn.disabled = true;
      return;
    }
    startFileTransferBtn.disabled = false;

    selectedFiles.forEach((file, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'selected-file-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'selected-file-name';
      nameSpan.textContent = file.name;

      const removeIcon = document.createElement('i');
      removeIcon.className = 'fas fa-trash text-red-500 cursor-pointer';
      removeIcon.addEventListener('click', () => {
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      });

      itemDiv.appendChild(nameSpan);
      itemDiv.appendChild(removeIcon);
      selectedFilesContainer.appendChild(itemDiv);
    });
  }

  sendFilesCancelBtn.addEventListener('click', () => {
    cancelSenderFlow();
  });

  startFileTransferBtn.addEventListener('click', () => {
    if (!currentRecipientId || selectedFiles.length === 0 || sendingInProgress) return;
    sendingInProgress = true;

    // Start sending each file in turn
    // 1) We'll send a "file-transfer-init" to let receiver know how many files total
    serverConnection.send({
      type: 'file-transfer-init',
      totalFiles: selectedFiles.length,
      to: currentRecipientId
    });

    // Then read & send files sequentially
    sendFilesModal.style.display = 'none';
    sendNextFile(0);
  });

  function sendNextFile(index) {
    if (index >= selectedFiles.length) {
      // Done
      serverConnection.send({
        type: 'file-transfer-complete',
        to: currentRecipientId
      });
      selectedFiles = [];
      sendingInProgress = false;
      return;
    }
    const file = selectedFiles[index];
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = new Uint8Array(reader.result);
      // Use smaller chunk size for better stability over WS
      const chunkSize = 32 * 1024; // 32KB
      let offset = 0;

      function sendChunk() {
        if (offset >= buffer.length) {
          // Done with this file => move on
          serverConnection.send({
            type: 'file-chunk',
            fileDone: true,
            fileName: file.name,
            to: currentRecipientId
          });
          sendNextFile(index + 1);
          return;
        }
        const end = Math.min(offset + chunkSize, buffer.length);
        const chunk = buffer.slice(offset, end);
        offset = end;

        // Convert chunk to base64 for sending via JSON
        const base64Chunk = arrayBufferToBase64(chunk);
        serverConnection.send({
          type: 'file-chunk',
          fileName: file.name,
          fileSize: file.size,
          chunk: base64Chunk,
          to: currentRecipientId
        });

        // Slight async pause to avoid saturating buffers
        setTimeout(sendChunk, 5);
      }

      // Start sending the first chunk
      sendChunk();
    };
    reader.readAsArrayBuffer(file);
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /***********************************************************
   * FILE RECEIVING SIDE
   **********************************************************/
  window.addEventListener('file-transfer-init', (e) => {
    // We know how many files are coming. Let's reset our local state.
    receivingFiles = [];
    receivingFilesInfo = [];
    fileProgressList.innerHTML = '';
    hideReceivingStatus();
    receivingFilesModal.style.display = 'flex';
  });

  window.addEventListener('file-chunk', (e) => {
    const msg = e.detail;
    // if we haven't seen this file yet, add it to receivingFilesInfo
    let fileInfo = receivingFilesInfo.find(f => f.name === msg.fileName);
    if (!fileInfo) {
      fileInfo = {
        name: msg.fileName,
        size: msg.fileSize || 0,
        chunks: [],
        progressBar: null,
        receivedBytes: 0
      };
      receivingFilesInfo.push(fileInfo);

      // Create a progress bar element
      const fileContainer = document.createElement('div');
      fileContainer.className = 'w-full';

      const fileLabel = document.createElement('p');
      fileLabel.textContent = msg.fileName;
      fileLabel.className = 'text-sm mb-1 text-[#333533]';

      const progressBarContainer = document.createElement('div');
      progressBarContainer.className = 'file-progress-bar-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'file-progress-bar';
      progressBar.style.width = '0%';

      progressBarContainer.appendChild(progressBar);
      fileContainer.appendChild(fileLabel);
      fileContainer.appendChild(progressBarContainer);
      fileProgressList.appendChild(fileContainer);

      fileInfo.progressBar = progressBar;
    }

    if (msg.chunk) {
      // decode base64 => array buffer
      const rawData = window.atob(msg.chunk);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      fileInfo.chunks.push(outputArray);
      fileInfo.receivedBytes += outputArray.length;

      // Update progress bar
      if (fileInfo.size) {
        const percent = (fileInfo.receivedBytes / fileInfo.size) * 100;
        fileInfo.progressBar.style.width = `${Math.floor(percent)}%`;
      }
    }

    if (msg.fileDone) {
      // Reconstruct the file from chunks
      const totalSize = fileInfo.chunks.reduce((acc, c) => acc + c.length, 0);
      const allData = new Uint8Array(totalSize);
      let offset = 0;
      fileInfo.chunks.forEach(c => {
        allData.set(c, offset);
        offset += c.length;
      });

      receivingFiles.push({
        name: fileInfo.name,
        size: totalSize,
        data: allData
      });
    }
  });

  window.addEventListener('file-transfer-finished', (e) => {
    // All files have been transferred
    receivingFilesModal.style.display = 'none';
    // Show preview
    currentFileIndex = 0;
    showFilePreviewModal();
  });

  function showFilePreviewModal() {
    if (receivingFiles.length === 0) return;
    filePreviewModal.style.display = 'flex';
    renderPreviewSlide(currentFileIndex);
  }

  function renderPreviewSlide(index) {
    if (index < 0 || index >= receivingFiles.length) return;
    filePreviewContent.innerHTML = '';
    const fileObj = receivingFiles[index];

    // Let’s do a quick check if it’s an image
    const isImage = isImageFile(fileObj.name);
    if (isImage) {
      const blob = new Blob([fileObj.data], { type: 'image/*' });
      const imgURL = URL.createObjectURL(blob);
      const imgEl = document.createElement('img');
      imgEl.src = imgURL;
      imgEl.className = 'max-w-full max-h-[400px] object-contain';
      filePreviewContent.appendChild(imgEl);
    } else {
      // Show a generic icon
      const icon = document.createElement('i');
      icon.className = 'fas fa-file fa-5x mb-2';
      filePreviewContent.appendChild(icon);

      const nameP = document.createElement('p');
      nameP.textContent = fileObj.name;
      filePreviewContent.appendChild(nameP);
    }
  }

  function isImageFile(fileName) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
  }

  prevFileBtn.addEventListener('click', () => {
    if (currentFileIndex > 0) {
      currentFileIndex--;
      renderPreviewSlide(currentFileIndex);
    }
  });
  nextFileBtn.addEventListener('click', () => {
    if (currentFileIndex < receivingFiles.length - 1) {
      currentFileIndex++;
      renderPreviewSlide(currentFileIndex);
    }
  });

  filePreviewClose.addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
    receivingFiles = [];
  });
  filePreviewBackdrop.addEventListener('click', () => {
    filePreviewModal.style.display = 'none';
    receivingFiles = [];
  });

  downloadCurrentFileBtn.addEventListener('click', () => {
    if (receivingFiles.length === 0) return;
    const fileObj = receivingFiles[currentFileIndex];
    downloadFile(fileObj);
  });

  downloadAllFilesBtn.addEventListener('click', () => {
    // Option 1: Zip them client-side or simply loop the downloads
    receivingFiles.forEach(f => {
      downloadFile(f);
    });
  });

  function downloadFile(fileObj) {
    const blob = new Blob([fileObj.data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileObj.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /***********************************************************
   * Info & Author Modals
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
});
