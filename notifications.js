class Notifications {
  constructor() {
      // Check if the browser supports notifications
      if (!('Notification' in window)) return;
      
      // Initialize notification permissions
      this.checkPermission();
      
      // Setup notification event listeners
      Events.on('text-received', e => this.textNotification(e.detail));
      Events.on('file-received', e => this.fileNotification(e.detail));
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
          icon: 'favicon.png', // Make sure to add a logo image to your server
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
              action: () => drplUI.dialogs.receiveText.showText(text)
          });
      }
  }
  
  fileNotification(file) {
      if (document.visibilityState === 'visible') return;
      
      this.notify('File Received', file.name, {
          action: () => {
              if (drplUI && drplUI.dialogs.receive) {
                  drplUI.dialogs.receive._displayFile(file);
              }
          }
      });
  }
}

// Initialize notifications
document.addEventListener('DOMContentLoaded', () => {
  const notifications = new Notifications();
});