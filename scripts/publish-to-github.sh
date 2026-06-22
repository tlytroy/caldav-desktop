#!/bin/bash

# CalDAV Desktop GitHub Publish Script
# This script helps automate the process of publishing to GitHub

echo "🚀 CalDAV Desktop GitHub Publish Script"
echo "======================================"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Get repository info
REPO_NAME="caldav-desktop"
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo "📦 Project Info:"
echo "   Name: $REPO_NAME"
echo "   Version: v$CURRENT_VERSION"
echo ""

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI (gh) not found. Please install it first:"
    echo "   https://cli.github.com/"
    echo ""
    echo "After installing, authenticate with: gh auth login"
    exit 1
fi

# Check if user is logged in
if ! gh auth status &> /dev/null; then
    echo "⚠️  Not logged into GitHub CLI. Please authenticate first:"
    echo "   gh auth login"
    exit 1
fi

echo "✅ GitHub CLI is ready"
echo ""

# Ask user for GitHub username
read -p "Enter your GitHub username: " GITHUB_USERNAME

if [ -z "$GITHUB_USERNAME" ]; then
    echo "❌ Username is required"
    exit 1
fi

echo ""
echo "🔧 Repository Setup"
echo "==================="

# Create repository if it doesn't exist
echo "Creating repository $GITHUB_USERNAME/$REPO_NAME..."
if gh repo view "$GITHUB_USERNAME/$REPO_NAME" &> /dev/null; then
    echo "✅ Repository already exists"
else
    gh repo create "$GITHUB_USERNAME/$REPO_NAME" --public --clone
    if [ $? -eq 0 ]; then
        echo "✅ Repository created successfully"
    else
        echo "❌ Failed to create repository"
        exit 1
    fi
fi

echo ""
echo "📤 Publishing Code"
echo "=================="

# Add remote if not exists
if ! git remote get-url origin &> /dev/null; then
    git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
fi

# Push code
echo "Pushing code to GitHub..."
git push -u origin main

if [ $? -eq 0 ]; then
    echo "✅ Code pushed successfully"
else
    echo "❌ Failed to push code"
    exit 1
fi

echo ""
echo "🏷️  Creating Release"
echo "===================="

# Create release
echo "Creating GitHub release v$CURRENT_VERSION..."
gh release create "v$CURRENT_VERSION" \
    --title "v$CURRENT_VERSION - Production Ready" \
    --notes "## CalDAV Desktop v$CURRENT_VERSION - Production Ready

🎉 Initial release of CalDAV Desktop - A cross-platform desktop calendar application with full CalDAV support!

### ✨ Features
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

### 📦 Installation
Pre-built packages available:
- Linux: \`CalDAV-Desktop-$CURRENT_VERSION-linux.AppImage\` (~100MB)
- Linux: \`CalDAV-Desktop-$CURRENT_VERSION-linux.tar.gz\` (~95MB)
- Windows/macOS: See [DEPLOYMENT.md](docs/DEPLOYMENT.md)

### 📚 Documentation
- [README.md](README.md) - Project overview and quick start
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Building and packaging for all platforms
- [TESTING.md](docs/TESTING.md) - Test plan and results (9/9 tests passing)
- [CHANGELOG.md](docs/CHANGELOG.md) - Version history and feature updates

### 🎯 Next Steps
- Windows/macOS packaging (see [DEPLOYMENT.md](docs/DEPLOYMENT.md))
- User feedback collection
- Performance monitoring
- v0.2: Advanced filtering, event search, more themes

---

Built with ❤️ using AI assistance"

if [ $? -eq 0 ]; then
    echo "✅ Release v$CURRENT_VERSION created successfully"
else
    echo "⚠️  Failed to create release (may already exist)"
fi

echo ""
echo "✅ Publish Complete!"
echo "===================="
echo "Your CalDAV Desktop project has been published to GitHub:"
echo "🔗 https://github.com/$GITHUB_USERNAME/$REPO_NAME"
echo "📄 README: https://github.com/$GITHUB_USERNAME/$REPO_NAME#readme"
echo "📥 Releases: https://github.com/$GITHUB_USERNAME/$REPO_NAME/releases"
echo ""
echo "Next steps:"
echo "1. Add screenshots to the repository"
echo "2. Configure GitHub Actions for CI/CD"
echo "3. Enable GitHub Pages for documentation"
echo "4. Set up issue templates"
echo ""
echo "Congratulations on your release! 🎉"