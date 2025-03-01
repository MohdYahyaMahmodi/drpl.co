/**
 * drpl.co - Notifications Javascript
 * Handles system notifications for incoming files, messages, and peer events
 */

// Create a global namespace for notifications to avoid conflicts
window.NotificationManager = (function() {
  /**
   * Check if text is a URL
   * @param {string} text - Text to check
   * @returns {boolean} - True if text is a URL
   */
  const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
  
  /**
   * NotificationHandler - Manages browser notifications
   */
  class NotificationHandler {
    /**
     * Initialize the notification system
     */
    constructor() {
      // Initialize property for tracking permission status
      this.hasPermission = false;
      
      // Check if the browser supports notifications
      if (!('Notification' in window)) {
        console.log('This browser does not support desktop notifications');
        return;
      }
      
      // Initialize notification permissions
      this.checkPermission();
      
      // Setup notification event listeners
      this._setupEventListeners();
    }
    
    /**
     * Set up event listeners for the notification triggers
     * @private
     */
    _setupEventListeners() {
      Events.on('text-received', e => this.textNotification(e.detail));
      Events.on('file-received', e => this.fileNotification(e.detail));
      Events.on('peer-joined', e => this.peerJoinedNotification(e.detail));
      Events.on('peer-left', e => this.peerLeftNotification(e.detail));
    }
    
    /**
     * Check current notification permission status
     */
    checkPermission() {
      if (Notification.permission === 'granted') {
        this.hasPermission = true;
      } else if (Notification.permission !== 'denied') {
        // We need to ask for permission
        this.requestPermission();
      }
    }
    
    /**
     * Request notification permission from the user
     * @returns {Promise} - Resolves when permission request is handled
     */
    requestPermission() {
      return Notification.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            this.hasPermission = true;
            this.notify('drpl.co', 'Notifications enabled');
          }
        })
        .catch(error => {
          console.error('Error requesting notification permission:', error);
        });
    }
    
    /**
     * Display a system notification
     * @param {string} title - Notification title
     * @param {string} body - Notification content
     * @param {Object} data - Additional notification data including actions
     * @returns {Notification|null} - Notification object if created
     */
    notify(title, body, data = {}) {
      // Check for permission and visibility
      if (!this.hasPermission) return null;
      if (document.visibilityState === 'visible') return null;
      
      try {
        // Create and configure the notification
        const notification = new Notification(title, {
          body: body,
          icon: 'favicon.png',
          data: data
        });
        
        // Set up click handler
        notification.onclick = () => {
          window.focus();
          notification.close();
          
          // Execute action if provided
          if (data.action && typeof data.action === 'function') {
            data.action();
          }
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
        
        return notification;
      } catch (error) {
        console.error('Error creating notification:', error);
        return null;
      }
    }
    
    /**
     * Create notification for text messages
     * @param {Object} data - Text message data
     */
    textNotification(data) {
      if (document.visibilityState === 'visible') return;
      
      const text = data.text;
      
      // Special handling for links
      if (isURL(text)) {
        this.notify('New Link Received', text, {
          action: () => window.open(text.startsWith('http') ? text : `http://${text}`, '_blank')
        });
      } else {
        // Truncate long messages for the notification
        const truncatedText = text.substring(0, 50) + (text.length > 50 ? '...' : '');
        
        this.notify('New Message', truncatedText, {
          action: () => {
            // Open the message in the receive dialog when clicked
            if (window.drplUI && window.drplUI.dialogs.receiveText) {
              window.drplUI.dialogs.receiveText.showText(text, data.sender);
            }
          }
        });
      }
    }
    
    /**
     * Create notification for received files
     * @param {Object} file - File data
     */
    fileNotification(file) {
      if (document.visibilityState === 'visible') return;
      
      this.notify('File Received', file.name, {
        action: () => {
          // Show the receive dialog when clicked
          if (window.drplUI && window.drplUI.dialogs.receive) {
            window.drplUI.dialogs.receive.show();
          }
        }
      });
    }
    
    /**
     * Create notification when a new peer joins
     * @param {Object} peer - Peer information
     */
    peerJoinedNotification(peer) {
      if (document.visibilityState === 'visible') return;
      
      this.notify('New Device Available', 
        `${peer.name.displayName} (${peer.name.deviceName}) joined the network`, {
          action: () => window.focus()
        }
      );
    }
    
    /**
     * Handle peer departure events
     * @param {string} peerId - ID of the departing peer
     */
    peerLeftNotification(peerId) {
      // We don't need to notify on peer departure
      // This method is kept to maintain event handler structure
    }
  }
  
  // Return the initialization function for external use
  return {
    /**
     * Initialize the notification handler
     * @returns {NotificationHandler} - New notification handler instance
     */
    init: function() {
      return new NotificationHandler();
    }
  };
})();

/**
 * Initialize when the DOM is fully loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('Notifications module loaded');
});