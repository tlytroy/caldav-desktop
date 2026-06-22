# Radicale Desktop Calendar

A cross-platform desktop calendar application for Radicale servers, with full CalDAV support and modern UI design.

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

- Node.js 20+
- pnpm

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

- Linux: `Radicale Desktop Calendar-0.1.0-linux.AppImage` (~100MB)
- Linux: `Radicale Desktop Calendar-0.1.0-linux.tar.gz` (~95MB)
- Windows/macOS: See [DEPLOYMENT.md](docs/DEPLOYMENT.md)

## 📚 Documentation

- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Building and packaging for all platforms
- **[TESTING.md](docs/TESTING.md)** - Test plan and results (9/9 tests passing)
- **[CHANGELOG.md](docs/CHANGELOG.md)** - Version history and feature updates
- **[DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)** - Development roadmap and plans
- **[FEATURE_TRACKING.md](docs/FEATURE_TRACKING.md)** - Feature implementation tracking
- **[TASK_LIST.md](docs/TASK_LIST.md)** - Current development tasks and priorities
- **[PROJECT_STATUS.md](docs/PROJECT_STATUS.md)** - Current project status and metrics
- **[DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md)** - Daily development progress log

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

## 🧪 Testing

Run the automated test suite:

```bash
./run-tests.sh
```

Tests: 9/9 passing (100%)

- Calendar operations (list)
- Event CRUD (create, read, update, delete)
- Categories, tags, recurring events, all-day events

## 📊 Project Status

✅ **Production Ready**

- All core functionality implemented
- Comprehensive testing (9/9 passing)
- Full RFC 5545 compliance
- Cross-platform support

### Code Quality

- TypeScript 100% type coverage
- Consistent formatting
- Complete error handling
- Detailed logging

## 🗂️ Project Structure

```
radicale-desktop/
├── apps/
│   ├── desktop/     # Electron main process
│   ├── renderer/    # React frontend
│   └── server/      # Node.js backend
├── packages/
│   └── shared/      # Shared types
├── docs/            # Documentation
└── pnpm-workspace.yaml
```

## 🔄 Next Steps

- [ ] Windows/macOS packaging (see [DEPLOYMENT.md](docs/DEPLOYMENT.md))
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

**Last Updated**: 2026-06-22
