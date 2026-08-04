#!/bin/bash

# CalDAV Calendar Android APK Build Script
# This script automates the process of building an Android APK from the web application

set -e  # Exit on any error

echo "=== CalDAV Calendar Android APK Builder ==="
echo ""

# Check if we're in the correct directory
if [ ! -f "package.json" ] || [ ! -d "apps/renderer" ]; then
    echo "Error: This script must be run from the project root directory."
    echo "Please navigate to the radicale-desktop project root and try again."
    exit 1
fi

echo "✓ Project root directory confirmed"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."
if ! command_exists java; then
    echo "Error: Java is not installed or not in PATH"
    echo "Please install Java 11 or higher and try again."
    exit 1
fi

if ! command_exists node; then
    echo "Error: Node.js is not installed or not in PATH"
    echo "Please install Node.js 16 or higher and try again."
    exit 1
fi

if ! command_exists npm; then
    echo "Error: npm is not installed or not in PATH"
    echo "Please install npm and try again."
    exit 1
fi

echo "✓ All prerequisites met"
echo ""

# Build the web application
echo "Step 1: Building web application..."
cd apps/renderer
if command_exists pnpm; then
    echo "Using pnpm to build..."
    pnpm run build
elif command_exists npm; then
    echo "Using npm to build..."
    npm run build
else
    echo "Error: Neither pnpm nor npm found"
    exit 1
fi
echo "✓ Web application built successfully"
echo ""

# Copy web assets to Android project
echo "Step 2: Copying web assets to Android project..."
npx cap copy android
echo "✓ Assets copied to Android project"
echo ""

# Build the Android APK
echo "Step 3: Building Android APK..."
cd android

# Make gradlew executable if it isn't already
chmod +x gradlew

# Build debug APK
./gradlew assembleDebug
echo "✓ Android APK built successfully"
echo ""

# Get the APK path
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_PATH" ]; then
    echo "=== BUILD SUCCESSFUL ==="
    echo "APK Location: $(pwd)/$APK_PATH"
    echo ""
    echo "To install on an Android device:"
    echo "1. Enable 'Developer Options' and 'USB Debugging' on your device"
    echo "2. Connect your device via USB"
    echo "3. Run: adb install $(pwd)/$APK_PATH"
    echo ""
    echo "To run automated tests:"
    echo "cd ../.. && npm run test"
else
    echo "Error: APK file was not found at expected location: $APK_PATH"
    exit 1
fi