/**
 * Background Animation
 * Animates growing, pulsating circles that rise from the bottom of the screen
 */
class BackgroundAnimation {
  constructor() {
      this.canvas = document.getElementById('background-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.circles = [];
      this.maxCircles = 10;
      this.animationFrameId = null;
      
      // Initialize the canvas and circles
      this.init();
      
      // Handle window resize
      window.addEventListener('resize', () => this.resize());
  }
  
  init() {
      this.resize();
      this.createInitialCircles();
      this.animate();
  }
  
  resize() {
      // Set canvas size to match the window
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
  }
  
  createInitialCircles() {
      // Create a few initial circles scattered on screen
      for (let i = 0; i < 3; i++) {
          this.createCircle(true);
      }
  }
  
  createCircle(randomY = false) {
      // Circle properties
      const circle = {
          x: Math.random() * this.canvas.width * 0.8 + this.canvas.width * 0.1, // Keep away from edges
          y: randomY ? this.canvas.height * Math.random() * 0.5 + this.canvas.height * 0.5 : this.canvas.height,
          size: 5, // Start small
          maxSize: 80 + Math.random() * 100, // Max size it will grow to
          growRate: 0.2 + Math.random() * 0.5, // How fast it grows
          opacity: 0.15 + Math.random() * 0.1, // Starting opacity
          speed: 0.8 + Math.random() * 1.2, // Speed moving upward
          pulseSpeed: 0.02 + Math.random() * 0.05, 
          pulseDirection: 1,
          pulseAmount: 0.05 + Math.random() * 0.1
      };
      
      this.circles.push(circle);
      
      // If we have too many circles, remove the oldest one
      if (this.circles.length > this.maxCircles) {
          this.circles.shift();
      }
      
      return circle;
  }
  
  updateCircles() {
      for (let i = this.circles.length - 1; i >= 0; i--) {
          const circle = this.circles[i];
          
          // Move circle upward
          circle.y -= circle.speed;
          
          // Grow the circle
          if (circle.size < circle.maxSize) {
              circle.size += circle.growRate;
          }
          
          // Add pulse effect to fully grown circles
          if (circle.size >= circle.maxSize * 0.9) {
              // Pulse around the max size
              circle.size += circle.pulseSpeed * circle.pulseDirection;
              
              // Change pulse direction when needed
              if (circle.size > circle.maxSize * (1 + circle.pulseAmount) || 
                  circle.size < circle.maxSize * (1 - circle.pulseAmount)) {
                  circle.pulseDirection *= -1;
              }
          }
          
          // Fade circle as it moves up
          const progress = 1 - (circle.y / this.canvas.height);
          circle.opacity = (0.15 + Math.random() * 0.1) * (1 - progress * 1.2); // Fade out faster
          
          // Remove circle if it moves off screen or becomes too transparent
          if (circle.y < -circle.maxSize || circle.opacity < 0.02) {
              this.circles.splice(i, 1);
              this.createCircle();
          }
      }
      
      // Occasionally add a new circle
      if (Math.random() < 0.03 && this.circles.length < this.maxCircles) {
          this.createCircle();
      }
  }
  
  drawCircles() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      for (const circle of this.circles) {
          this.ctx.beginPath();
          this.ctx.arc(circle.x, circle.y, circle.size, 0, Math.PI * 2);
          this.ctx.fillStyle = `rgba(0, 0, 0, ${circle.opacity})`;
          this.ctx.fill();
      }
  }
  
  animate() {
      this.updateCircles();
      this.drawCircles();
      
      // Continue animation
      this.animationFrameId = requestAnimationFrame(() => this.animate());
  }
  
  pause() {
      if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
      }
  }
  
  resume() {
      if (!this.animationFrameId) {
          this.animate();
      }
  }
}

// Initialize the background animation when the document is ready
document.addEventListener('DOMContentLoaded', () => {
  const backgroundAnimation = new BackgroundAnimation();
  
  // Pause animation when the page is hidden (saves resources)
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
          backgroundAnimation.pause();
      } else {
          backgroundAnimation.resume();
      }
  });
  
  // Force initial circles
  for (let i = 0; i < 5; i++) {
      backgroundAnimation.createCircle();
  }
});