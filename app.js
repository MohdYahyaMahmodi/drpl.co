// Word lists for generating device names
const adjectives = ['Red', 'Blue', 'Green', 'Purple', 'Golden', 'Silver', 'Crystal', 'Cosmic', 'Electric', 'Mystic'];
const nouns = ['Wolf', 'Eagle', 'Lion', 'Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Panther', 'Hawk', 'Bear'];

function generateDeviceName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
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
        // Check if it's a laptop or desktop based on screen size
        return window.innerWidth <= 1366 ? 'laptop' : 'desktop';
    }
    return 'desktop'; // Default fallback
}

function appData() {
  return {
      peers: [],
      deviceName: generateDeviceName(),
      deviceType: detectDeviceType(),
      showInfo: false,
      showFileTransfer: false,
      showProgress: false,
      selectedFiles: [],
      isDragging: false,
      selectedPeer: null,
      transferProgress: 0,
      transferStatus: '',
      transferDetails: '',
      isReceivingFile: false,
      receivingDetails: null,
      showAuthor: false,
      showIncomingRequest: false,
      showFilePreview: false,
      currentFileIndex: 0,
      receivedFiles: [], // Will store file objects with preview URLs

      init() {
          // Initial setup
          this.setupPeerDiscovery();
          this.setupFileReceiver();

          // Listen for window resize to update device type
          window.addEventListener('resize', () => {
              this.deviceType = detectDeviceType();
          });
      },

      setupPeerDiscovery() {
          // Simulate peer discovery (replace with actual WebRTC implementation)
          setTimeout(() => {
              this.peers = [
                  { 
                      id: generateDeviceName(), 
                      name: 'iPhone 13', 
                      type: 'mobile'
                  },
                  { 
                      id: generateDeviceName(), 
                      name: 'MacBook Pro', 
                      type: 'laptop'
                  },
                  { 
                      id: generateDeviceName(), 
                      name: 'Desktop PC', 
                      type: 'desktop'
                  },
                  { 
                      id: generateDeviceName(), 
                      name: 'iPad Air', 
                      type: 'tablet'
                  }
              ];
          }, 2000);
      },

      setupFileReceiver() {
          // Simulate receiving a file after 3 seconds (for demo purposes)
          setTimeout(() => {
              this.handleIncomingTransfer(
                  { id: 'Red Eagle', name: 'iPhone' },
                  { 
                      files: [
                          { name: 'image.jpg', size: 1024 * 1024, type: 'image/jpeg' },
                          { name: 'document.pdf', size: 2048 * 1024, type: 'application/pdf' }
                      ],
                      totalSize: 3072 * 1024
                  }
              );
          }, 3000);
      },

      selectPeer(peer) {
          this.selectedPeer = peer;
          this.showFileTransfer = true;
          this.selectedFiles = [];
      },

      handleFileDrop(event) {
          event.preventDefault();
          this.isDragging = false;
          this.selectedFiles = Array.from(event.dataTransfer.files);
      },

      handleFileSelect(event) {
          this.selectedFiles = Array.from(event.target.files);
      },

      isImageFile(file) {
          return file?.type?.startsWith('image/');
      },

      getFileIcon(file) {
          const type = file?.type || '';
          if (type.startsWith('image/')) return 'fas fa-image';
          if (type.startsWith('video/')) return 'fas fa-video';
          if (type.startsWith('audio/')) return 'fas fa-music';
          if (type.startsWith('text/')) return 'fas fa-file-alt';
          if (type.includes('pdf')) return 'fas fa-file-pdf';
          if (type.includes('word')) return 'fas fa-file-word';
          if (type.includes('excel') || type.includes('spreadsheet')) return 'fas fa-file-excel';
          if (type.includes('zip') || type.includes('rar')) return 'fas fa-file-archive';
          if (type.includes('powerpoint') || type.includes('presentation')) return 'fas fa-file-powerpoint';
          return 'fas fa-file';
      },

      getCurrentFile() {
          return this.receivedFiles[this.currentFileIndex] || {};
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
          // In real implementation, this would use the actual file data
          // For demo, we'll just create a dummy download
          const a = document.createElement('a');
          a.href = file.preview || file.url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      },

      async sendFiles() {
          if (this.selectedFiles.length === 0) return;

          this.showFileTransfer = false;
          this.showProgress = true;
          this.transferStatus = 'Initiating Transfer...';
          this.transferProgress = 0;
          this.transferDetails = 'Preparing files...';

          const totalSize = this.selectedFiles.reduce((acc, file) => acc + file.size, 0);
          let transferred = 0;

          for (const file of this.selectedFiles) {
              await new Promise(resolve => {
                  const interval = setInterval(() => {
                      transferred += file.size / 10;
                      this.transferProgress = Math.min(100, Math.round((transferred / totalSize) * 100));
                      this.transferStatus = 'Sending Files...';
                      this.transferDetails = `${this.transferProgress}% complete (${formatFileSize(transferred)} of ${formatFileSize(totalSize)})`;

                      if (transferred >= totalSize) {
                          clearInterval(interval);
                          resolve();
                      }
                  }, 500);
              });
          }

          this.transferStatus = 'Transfer Complete!';
          this.transferDetails = 'All files have been sent successfully';
          
          setTimeout(() => {
              this.showProgress = false;
              this.selectedFiles = [];
          }, 2000);
      },

      handleIncomingTransfer(peer, fileDetails) {
          this.isReceivingFile = true;
          this.receivingDetails = {
              peer: peer,
              fileCount: fileDetails.files.length,
              totalSize: fileDetails.totalSize,
              files: fileDetails.files
          };
          
          // Show incoming request modal
          this.showIncomingRequest = true;
      },

      acceptTransfer() {
          this.showIncomingRequest = false;
          this.showProgress = true;
          this.transferStatus = 'Receiving Files...';
          this.transferProgress = 0;

          // Simulate receiving files
          const totalSize = this.receivingDetails.totalSize;
          let received = 0;

          const interval = setInterval(() => {
              received += totalSize / 10;
              this.transferProgress = Math.min(100, Math.round((received / totalSize) * 100));
              this.transferDetails = `${this.transferProgress}% complete (${formatFileSize(received)} of ${formatFileSize(totalSize)})`;

              if (received >= totalSize) {
                  clearInterval(interval);
                  this.transferStatus = 'Transfer Complete!';
                  this.transferDetails = 'Files received successfully';

                  // Simulate creating preview URLs
                  this.receivedFiles = this.receivingDetails.files.map(file => ({
                      ...file,
                      preview: this.isImageFile(file) 
                          ? 'https://picsum.photos/800/600' // Demo image URL
                          : null
                  }));
                  
                  setTimeout(() => {
                      this.showProgress = false;
                      this.isReceivingFile = false;
                      this.showFilePreview = true;
                  }, 1000);
              }
          }, 500);
      },

      rejectTransfer() {
          this.showIncomingRequest = false;
          this.isReceivingFile = false;
          this.receivingDetails = null;
      }
  };
}