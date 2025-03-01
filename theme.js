// Theme toggling functionality
class ThemeManager {
  constructor() {
    this.themeToggle = document.getElementById('theme-toggle');
    this.themeIcon = this.themeToggle.querySelector('i');
    this.currentTheme = localStorage.getItem('theme') || 'dark';
    
    this.init();
  }
  
  init() {
    // Apply saved theme on page load
    this.applyTheme(this.currentTheme);
    
    // Setup event listener for toggle button
    this.themeToggle.addEventListener('click', () => this.toggleTheme());
  }
  
  toggleTheme() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(this.currentTheme);
    localStorage.setItem('theme', this.currentTheme);
  }
  
  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      this.themeIcon.classList.remove('fa-moon');
      this.themeIcon.classList.add('fa-sun');
    } else {
      document.documentElement.removeAttribute('data-theme');
      this.themeIcon.classList.remove('fa-sun');
      this.themeIcon.classList.add('fa-moon');
    }
  }
}

// Initialize the theme manager when DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ThemeManager();
});