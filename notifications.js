// Create a global namespace for notifications to avoid conflicts
window.NotificationManager = (function() {
  const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
  
  class NotificationHandler {
    constructor() {
      // Check if the browser supports notifications
      if (!('Notification' in window)) return;
      
      // Initialize notification permissions
      this.checkPermission();
      
      // Setup notification event listeners
      Events.on('text-received', e => this.textNotification(e.detail));
      Events.on('file-received', e => this.fileNotification(e.detail));
      Events.on('peer-joined', e => this.peerJoinedNotification(e.detail));
      Events.on('peer-left', e => this.peerLeftNotification(e.detail));
    }
    
    checkPermission() {
      if (Notification.permission === 'granted') {
        this.hasPermission = true;
      } else if (Notification.permission !== 'denied') {
        // We need to ask for permission
        this.requestPermission();
      }
    }
    
    requestPermission() {
      Notification.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            this.hasPermission = true;
            this.notify('drpl.co', 'Notifications enabled');
          }
        });
    }
    
    notify(title, body, data = {}) {
      if (!this.hasPermission) return;
      if (document.visibilityState === 'visible') return;
      
      const notification = new Notification(title, {
        body: body,
        icon: 'favicon.png',
        data: data
      });
      
      notification.onclick = () => {
        window.focus();
        notification.close();
        
        if (data.action) {
          data.action();
        }
      };
      
      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
      
      return notification;
    }
    
    textNotification(data) {
      if (document.visibilityState === 'visible') return;
      
      const text = data.text;
      if (isURL(text)) {
        this.notify('New Link Received', text, {
          action: () => window.open(text, '_blank')
        });
      } else {
        this.notify('New Message', text.substring(0, 50) + (text.length > 50 ? '...' : ''), {
          action: () => {
            if (window.drplUI && window.drplUI.dialogs.receiveText) {
              window.drplUI.dialogs.receiveText.showText(text, data.sender);
            }
          }
        });
      }
    }
    
    fileNotification(file) {
      if (document.visibilityState === 'visible') return;
      
      this.notify('File Received', file.name, {
        action: () => {
          if (window.drplUI && window.drplUI.dialogs.receive) {
            window.drplUI.dialogs.receive.show();
          }
        }
      });
    }
    
    peerJoinedNotification(peer) {
      if (document.visibilityState === 'visible') return;
      
      this.notify('New Device Available', `${peer.name.displayName} (${peer.name.deviceName}) joined the network`, {
        action: () => window.focus()
      });
    }
    
    peerLeftNotification(peerId) {
      // We don't need to notify on peer departure
    }
  }
  
  // Return the constructor for external use
  return {
    init: function() {
      return new NotificationHandler();
    }
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  console.log('Notifications module loaded');
});