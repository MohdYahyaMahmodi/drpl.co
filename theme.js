// Theme handling
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  
  // Initial state
  const darkMode = document.documentElement.getAttribute('data-theme') === 'dark';
  updateThemeIcon(darkMode);
  
  // Handle clicks
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    // Update DOM
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // Save preference
    localStorage.setItem('theme', newTheme);
    
    // Update icon
    updateThemeIcon(newTheme === 'dark');
    
    // Notify other components
    dispatchThemeChangedEvent();
  });
  
  function updateThemeIcon(isDark) {
    const icon = themeToggle.querySelector('i');
    if (icon) {
      icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
  }
  
  function dispatchThemeChangedEvent() {
    const event = new CustomEvent('theme-changed', {
      detail: {
        theme: document.documentElement.getAttribute('data-theme')
      }
    });
    document.dispatchEvent(event);
  }
});