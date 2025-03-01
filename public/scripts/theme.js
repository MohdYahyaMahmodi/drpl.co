/**
 * drpl.co - Theme Javascript
 * Handles theme switching between light and dark modes
 */

/**
 * ThemeManager - Controls theme switching and persistence
 * @class
 */
class ThemeManager {
  /**
   * Initialize the theme manager
   * @constructor
   */
  constructor() {
    this.themeToggle = document.getElementById('theme-toggle');
    
    // Exit if toggle element doesn't exist
    if (!this.themeToggle) {
      console.log('Theme toggle element not found');
      return;
    }
    
    this.initialize();
  }
  
  /**
   * Set up initial state and event listeners
   */
  initialize() {
    // Check the current theme
    const darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    this.updateThemeIcon(darkMode);
    
    // Set up click handler for theme toggle
    this.themeToggle.addEventListener('click', () => this.toggleTheme());
    
    // Listen for system theme changes if supported
    this.setupSystemThemeListener();
  }
  
  /**
   * Toggle between light and dark themes
   */
  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    // Update DOM
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // Save preference to local storage
    localStorage.setItem('theme', newTheme);
    
    // Update icon
    this.updateThemeIcon(newTheme === 'dark');
    
    // Notify other components
    this.dispatchThemeChangedEvent();
  }
  
  /**
   * Update the theme toggle icon based on current theme
   * @param {boolean} isDark - True if dark theme is active
   */
  updateThemeIcon(isDark) {
    const icon = this.themeToggle.querySelector('i');
    if (icon) {
      icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
  }
  
  /**
   * Dispatch custom event when theme changes
   */
  dispatchThemeChangedEvent() {
    const event = new CustomEvent('theme-changed', {
      detail: {
        theme: document.documentElement.getAttribute('data-theme')
      }
    });
    document.dispatchEvent(event);
  }
  
  /**
   * Set up listener for system theme preference changes
   */
  setupSystemThemeListener() {
    // Check if browser supports color scheme detection
    if (window.matchMedia) {
      const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // Modern browsers
      if (colorSchemeQuery.addEventListener) {
        colorSchemeQuery.addEventListener('change', e => {
          // Only apply if user hasn't set a preference
          if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            this.updateThemeIcon(e.matches);
            this.dispatchThemeChangedEvent();
          }
        });
      } 
      // Older implementation
      else if (colorSchemeQuery.addListener) {
        colorSchemeQuery.addListener(e => {
          if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            this.updateThemeIcon(e.matches);
            this.dispatchThemeChangedEvent();
          }
        });
      }
    }
  }
}

/**
 * Initialize theme manager when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  window.themeManager = new ThemeManager();
});