#!/bin/bash

# SSM.7 Remediation Lambda Build Script
# This script builds the TypeScript Lambda function and creates a deployment package

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR"

echo "🔨 Building SSM.7 Remediation Lambda..."

# Navigate to Lambda directory
cd "$LAMBDA_DIR"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/
rm -rf node_modules/
rm -f ../ssm7-remediation.zip

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔧 Compiling TypeScript..."
npm run build

# Verify build output
if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed - index.js not found in dist/"
    exit 1
fi

echo "✅ Build completed successfully!"
