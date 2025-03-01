<img src="https://ghtb-counter.vercel.app/api/counter?username=Drpl.co&label=Views&color=000000&labelColor=000000&labelBgColor=ffffff&countColor=ffffff&style=flat" alt="Views" />

# drpl.co

<p align="center">
  <img src="https://drpl.co/images/favicon.png" alt="drpl.co logo" width="120" height="120">
</p>

<p align="center">
  <a href="https://github.com/MohdYahyaMahmodi/drpl.co/stargazers"><img src="https://img.shields.io/github/stars/MohdYahyaMahmodi/drpl.co" alt="Stars"></a>
  <a href="https://github.com/MohdYahyaMahmodi/drpl.co/network/members"><img src="https://img.shields.io/github/forks/MohdYahyaMahmodi/drpl.co" alt="Forks"></a>
  <a href="https://github.com/MohdYahyaMahmodi/drpl.co/issues"><img src="https://img.shields.io/github/issues/MohdYahyaMahmodi/drpl.co" alt="Issues"></a>
  <a href="https://github.com/MohdYahyaMahmodi/drpl.co/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MohdYahyaMahmodi/drpl.co" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-all_browsers-blue" alt="Platform">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">
</p>

## Open-Source Peer-to-Peer File Sharing for All Devices

**drpl.co** is a free, open-source file sharing solution that works across all platforms without requiring apps, accounts, or device-specific limitations. Share files instantly between any devices on the same network.

Visit the live site: [https://drpl.co](https://drpl.co)

## Demo

<p align="center">
  <b>Desktop Interface</b><br>
  <img src="https://drpl.co/images/image.png" alt="drpl.co desktop interface" width="800"><br><br>
  <b>Mobile Interface</b><br>
  <img src="https://drpl.co/images/mobile.png" alt="drpl.co mobile interface" width="300">
</p>

> Note: Replace the image URLs with actual screenshots of your application once you've uploaded them to your GitHub repository.

## Features

- **Cross-Platform Compatibility**: Works on all major operating systems and devices
- **No Installation Required**: Just open the website in your browser
- **No Account Needed**: No sign-ups, no tracking
- **Local Network Only**: Files transfer directly between devices on the same network
- **End-to-End Privacy**: Files are never uploaded to external servers
- **No File Size Limits**: Send any file type of any size
- **Text Messaging**: Send quick text messages along with files
- **Simplified Interface**: Clean, intuitive design that works on mobile and desktop

## How It Works

drpl.co uses WebRTC (with WebSocket fallback) to establish direct connections between devices on the same network. When you open drpl.co in your browser, the server assigns you a unique identifier and a friendly display name. Other devices on your network running drpl.co will automatically appear, allowing direct file transfers.

### Technical Details

- **Server Component**: Lightweight Node.js server provides signaling to establish peer connections
- **WebRTC Data Channels**: Used for peer-to-peer data transfer when supported by the browser
- **WebSocket Fallback**: Ensures compatibility with all browsers
- **Progressive Web App**: Can be installed on mobile devices
- **Responsive Design**: Adapts to all screen sizes
- **Local Discovery**: Devices find each other through the signaling server

### Privacy & Security

drpl.co is designed with privacy as a core principle:

- Files transfer directly between devices, never passing through our servers
- No analytics or tracking scripts
- No data collection
- No accounts or login requirements
- All code is open source and can be self-hosted

## Getting Started

### Using the Public Service

1. Open [https://drpl.co](https://drpl.co) on two or more devices connected to the same network
2. You'll see other devices appear automatically in the interface
3. Click on a device to connect and choose to send files or messages
4. Select files or type your message
5. The recipient will receive a notification and can download the files or view messages

### Local Development Setup

To run drpl.co locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/MohdYahyaMahmodi/drpl.co.git
   cd drpl.co
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   node server.js
   ```

4. Open `http://localhost:3002` in your browser

5. For local testing with multiple devices, make sure they can reach your development machine via your local IP address (e.g., `http://192.168.1.100:3002`)

## Self-Hosting

drpl.co can be easily self-hosted on your own server:

1. Clone the repository to your server
2. Install dependencies with `npm install`
3. Configure your web server (nginx, Apache, etc.) to proxy requests to the Node.js application
4. Start the server with PM2 or a similar process manager:
   ```bash
   pm2 start server.js --name drpl
   ```

### Optional: HTTPS Setup for Production

For a production environment, it's recommended to set up HTTPS:

1. Obtain SSL certificates (e.g., using Let's Encrypt)
2. Configure your web server to use these certificates
3. Set up a reverse proxy to your Node.js application

Example nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Project Structure

- `index.html` - Main application HTML
- `styles.css` - CSS styling for the application
- `server.js` - WebSocket signaling server
- `network.js` - Handles WebRTC connections and file transfers
- `ui.js` - User interface interactions and event handling
- `theme.js` - Theme switching functionality
- `background-animation.js` - Canvas animation for the background
- `notifications.js` - Browser notification handling

## Technical Implementation Details

### Signaling Server

The signaling server (`server.js`) facilitates the discovery of peers on the local network. Key components:

- WebSocket server for real-time communication
- Room management based on IP addresses
- Peer tracking and event propagation
- Keep-alive mechanism to maintain connections

### WebRTC Implementation

The `network.js` file implements the WebRTC peer connections:

- ICE candidate exchange
- SDP offer/answer exchange
- Data channel establishment
- Chunked file transfer with progress tracking
- Fallback to WebSocket when WebRTC is unavailable

### UI Components

The `ui.js` file manages the interface and user experience:

- Device discovery and representation
- Dialog management for file transfers
- File carousel for viewing received files
- Progress indicators during transfers
- Theme switching and responsive design

## Browser Compatibility

drpl.co works on all modern browsers, including:
- Chrome / Edge / Brave (desktop and mobile)
- Firefox (desktop and mobile)
- Safari (desktop and mobile)
- Opera

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Maintain the existing code style
- Add JSDoc comments for new functions
- Test across multiple devices and browsers
- Ensure responsive design works on all screen sizes

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by projects like [SnapDrop](https://snapdrop.net)
- Uses [WebRTC](https://webrtc.org/) for peer-to-peer communication
- Built with Node.js and Express

## Author

**Mohd Yahya Mahmodi**

- Website: [mohdmahmodi.com](https://mohdmahmodi.com)
- Twitter: [@mohdmahmodi](https://x.com/mohdmahmodi)
- Email: mohdmahmodi@pm.me

## Support This Project

If you find drpl.co useful, please consider:

- ⭐ Starring the repository on GitHub
- 🔄 Sharing the project with friends and colleagues
- 🐛 Reporting bugs and suggesting features
- 💻 Contributing code or documentation