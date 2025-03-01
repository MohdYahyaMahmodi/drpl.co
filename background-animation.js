// Background animation
class BackgroundAnimation {
  constructor() {
    this.canvas = document.getElementById('background-canvas');
    if (!this.canvas) return;
    
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    this.initParticles();
    this.animate();
    
    // Handle resize events
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Set dark mode based on data-theme attribute
    this.updateTheme();
    document.addEventListener('theme-changed', () => this.updateTheme());
  }
  
  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    // Re-initialize particles on resize
    if (this.particles) {
      this.initParticles();
    }
  }
  
  updateTheme() {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    this.particleColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    this.lineColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
  }
  
  initParticles() {
    // Calculate number of particles based on screen size
    const particleCount = Math.min(100, Math.floor(this.canvas.width * this.canvas.height / 15000));
    
    this.particles = [];
    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: Math.random() * 3 + 1,
        vx: Math.random() * 0.5 - 0.25,
        vy: Math.random() * 0.5 - 0.25
      });
    }
  }
  
  animate() {
    if (!this.ctx) return;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Update and draw particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      
      // Move particles
      p.x += p.vx;
      p.y += p.vy;
      
      // Bounce off edges
      if (p.x < 0 || p.x > this.canvas.width) p.vx = -p.vx;
      if (p.y < 0 || p.y > this.canvas.height) p.vy = -p.vy;
      
      // Draw particle
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.particleColor;
      this.ctx.fill();
      
      // Draw connections
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Only draw connections if particles are close enough
        if (distance < 150) {
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = this.lineColor;
          this.ctx.lineWidth = 1;
          this.ctx.stroke();
        }
      }
    }
    
    requestAnimationFrame(() => this.animate());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Will be initialized in the UI code
  console.log('Background animation loaded');
});