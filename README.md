# CalDAV Desktop - Cross-Platform Calendar Application

A cross-platform desktop calendar application with full CalDAV support and modern UI design.

Built with the help of AI assistance, this project addresses the lack of standalone CalDAV calendar applications on Windows, providing a lightweight alternative to email clients that bundle calendar functionality.

![Version](https://img.shields.io/badge/version-0.1.0-blue) ![Status](https://img.shields.io/badge/status-production%20ready-green)

## ✨ Features

- **CalDAV Sync**: Full synchronization with Radicale servers (RFC 5545 compliant)
- **Event Management**: Create, edit, delete events with full CRUD operations
- **Advanced Features**:
  - Event categories for organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day events
- **Modern Design**:
  - 4 Morandi color schemes + custom colors
  - Unified rounded corner design system
  - Full dark mode support
  - Responsive layout
- **Cross-Platform**: Linux, Windows, macOS (packaged as Electron app)

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ LTS
- pnpm
- Linux environment (native or WSL2) for building

### Installation & Development

```bash
# Install dependencies
pnpm install

# Start backend server (port 3001)
cd apps/server && pnpm dev

# Start frontend dev server (port 5173)
cd apps/renderer && pnpm dev
```

Backend API: http://localhost:3001/api/calendar
Frontend: http://localhost:5173/

### Configuration

Create `.env` file in project root:

```
RADICALE_URL=https://your-radicale-server.com
RADICALE_USERNAME=your_username
RADICALE_PASSWORD=your_password
```

## 📦 Builds

Pre-built packages available in `apps/desktop/dist-electron/`:

- Linux: `CalDAV-Desktop-0.1.0-linux.AppImage` (~100MB)
- Linux: `CalDAV-Desktop-0.1.0-linux.tar.gz` (~95MB)
- Windows/macOS: See Deployment section below

### Linux (All Distributions)

#### Build Steps

```bash
# Install dependencies
pnpm install

# Build for Linux
cd apps/desktop
pnpm build

# Package as AppImage and tar.gz
pnpm package:linux
```

#### Outputs

Generated in `apps/desktop/dist-electron/`:
- AppImage: Self-contained executable with no dependencies
- tar.gz: Compressed archive for manual installation

### Windows

```bash
# Package for Windows
cd apps/desktop
pnpm package:win
```

### macOS

```bash
# Package for macOS
cd apps/desktop
pnpm package:mac
```

## 🧪 Testing

### Automated API Tests

```bash
./run-tests.sh
```

This script runs 9 comprehensive tests covering all backend functionality.

**Test Results: 9/9 PASSING (100%)**

### Manual Frontend Tests

Start the dev servers first:

```bash
cd apps/server && pnpm dev      # Terminal 1
cd apps/renderer && pnpm dev    # Terminal 2
```

Then visit http://localhost:5173/ in your browser.

## Test Coverage

### Backend API Tests (9/9 Passing)

1. List calendars from Radicale server
2. Fetch events from calendar
3. Create new event
4. Update existing event
5. Delete event
6. Handle event categories
7. Process event tags
8. Manage recurring events
9. Support all-day events

## 📊 Changelog

### [0.1.0] - 2026-06-22

#### 🎉 Initial Release - Production Ready

##### ✨ Core Features Implemented

- **CalDAV Integration**: Full synchronization with Radicale servers
- **Event Management**: Complete CRUD operations (create, read, update, delete)
- **Event Properties**:
  - Categories for event organization
  - Multi-tag support for flexible grouping
  - Recurring events (daily, weekly, monthly, yearly)
  - All-day event support
  - RFC 5545 standard compliance

##### 🎨 Design System (New in v0.1.0)

**Morandi Color Schemes**

- Classic Morandi: Soft gray palette for serene interface
- Earth Brown: Warm brown tones for natural feel
- Blue-Green: Fresh cool tones for clarity
- Purple-Gray: Elegant sophisticated palette
- Custom color picker for personalization

**Unified Rounded Corner Design**

Consistent rounded corners throughout the interface for modern aesthetic.

**Dark Mode**

Full dark mode support with automatic system preference detection.

## 🏗️ Architecture

```
┌─────────────────────────┐
│  Electron (Desktop)     │
│  React + Tailwind CSS   │
│  FullCalendar           │
└────────────┬────────────┘
             │ JSON/REST API
             ▼
┌─────────────────────────┐
│  Node.js Backend        │
│  Express.js             │
│  CalDAV Client (tsdav)  │
└────────────┬────────────┘
             │ CalDAV/XML
             ▼
        ┌──────────────┐
        │  Radicale    │
        │  Server      │
        └──────────────┘
```

## 🗂️ Project Structure

```
radicale-desktop/
├── apps/
│   ├── desktop/     # Electron main process
│   ├── renderer/    # React frontend
│   └── server/      # Node.js backend
├── docs/            # Documentation
└── pnpm-workspace.yaml
```

## 🔄 Next Steps

- [ ] Windows/macOS packaging improvements
- [ ] User feedback collection
- [ ] Performance monitoring
- [ ] v0.2: Advanced filtering, event search, more themes

## 📝 Not in v1

- Meeting invitations
- Complex timezones
- Multiple account support

## 📄 License

[Add your license here]

## 🤝 Contributing

Contributions welcome! See existing code style and structure.

## 🤖 AI-Assisted Development

This project was developed with the help of AI coding assistants, demonstrating how modern AI tools can accelerate software development while maintaining high code quality and best practices.

---
**Last Updated**: 2026-06-25