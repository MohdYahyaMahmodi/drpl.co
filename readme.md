# drpl.co

![drpl.co logo](https://drpl.co/favicon.png)

## Open-Source Peer-to-Peer File Sharing for All Devices

**drpl.co** is a free, open-source file sharing solution that works across all platforms without requiring apps, accounts, or device-specific limitations. Share files instantly between any devices on the same network.

Visit the live site: [https://drpl.co](https://drpl.co)

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
   ```
   git clone https://github.com/MohdYahyaMahmodi/drpl.co.git
   cd drpl.co
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
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
   ```
   pm2 start server.js --name drpl
   ```

### Self-Hosting with Docker

We provide a Dockerfile for easy containerization:

```
docker build -t drpl .
docker run -p 3002:3002 drpl
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

**Mohd Mahmodi**

- Website: [mohdmahmodi.com](https://mohdmahmodi.com)
- Twitter: [@mohdmahmodi](https://x.com/mohdmahmodi)
- Email: mohdmahmodi@pm.me

## Support This Project

If you find drpl.co useful, please consider:

- ⭐ Starring the repository on GitHub
- 🔄 Sharing the project with friends and colleagues
- 🐛 Reporting bugs and suggesting features
- 💻 Contributing code or documentation