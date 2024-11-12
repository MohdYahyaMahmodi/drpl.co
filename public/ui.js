// ui.js

// Utility functions
function generateDeviceName() {
  const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
  const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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

function appData() {
  return {
      // UI state
      deviceName: generateDeviceName(),
      deviceType: detectDeviceType(),
      peers: [],
      selectedFiles: [],
      selectedPeer: null,
      showInfo: false,
      showAuthor: false,
      showFileTransfer: false,
      showProgress: false,
      isDragging: false,
      transferProgress: 0,
      transferStatus: '',
      transferDetails: '',
      isReceivingFile: false,
      receivedFiles: [],
      showIncomingRequest: false,
      receivingDetails: null,
      showFilePreview: false,
      currentFileIndex: 0,

      // Initialize the application
      init() {
          // Initialize file transfer logic
          fileTransfer.init(this);
          window.addEventListener('beforeunload', () => {
              fileTransfer.cleanupConnections();
          });
          toastr.options = {
              "closeButton": true,
              "progressBar": true,
              "positionClass": "toast-bottom-right",
              "preventDuplicates": true,
              "timeOut": "5000",
          };
      },

      // UI methods
      selectPeer(peer) {
          this.selectedPeer = peer;
          this.showFileTransfer = true;
          this.selectedFiles = [];
          fileTransfer.connectToPeer(peer);
      },

      handleFileDrop(event) {
          event.preventDefault();
          this.isDragging = false;
          this.selectedFiles = Array.from(event.dataTransfer.files);
      },

      handleFileSelect(event) {
          this.selectedFiles = Array.from(event.target.files);
      },

      sendFiles() {
          if (this.selectedFiles.length === 0 || !this.selectedPeer) return;
          fileTransfer.sendFiles(this.selectedFiles, this.selectedPeer);
          this.transferStatus = 'Waiting for recipient to accept...';
          this.showProgress = true;
          this.showFileTransfer = false;
      },

      acceptTransfer() {
          this.showIncomingRequest = false;
          this.showProgress = true;
          this.transferStatus = 'Preparing to receive files...';
          fileTransfer.acceptTransfer();
      },

      rejectTransfer() {
          this.showIncomingRequest = false;
          fileTransfer.rejectTransfer();
          toastr.info('File transfer rejected', 'Transfer Rejected');
      },

      // File preview navigation
      getCurrentFile() {
          return this.receivedFiles[this.currentFileIndex] || {};
      },
      isImageFile(file) {
          return file?.type?.startsWith('image/');
      },
      nextFile() {
          if (this.currentFileIndex < this.receivedFiles.length - 1) {
              this.currentFileIndex++;
          }
      },
      prevFile() {
          if (this.currentFileIndex > 0) {
              this.currentFileIndex--;
          }
      },
      downloadFile(file) {
          const a = document.createElement('a');
          a.href = file.url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      },
      async downloadAllFilesAsZip() {
          if (this.receivedFiles.length === 0) return;
          const zip = new JSZip();
          for (const file of this.receivedFiles) {
              zip.file(file.name, file.blob);
          }
          const content = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'files.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      }
  };
}
