#!/bin/bash

set -e

echo "🚀 Installing development tools: nvm, Node.js (stable), and Claude Code"
echo "=================================================================="

# Check if git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git is required but not installed. Please install git first."
    exit 1
fi

# Install nvm
echo "📦 Installing nvm (Node Version Manager)..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Load nvm into current shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Verify nvm installation
if ! command -v nvm &> /dev/null; then
    echo "❌ nvm installation failed"
    exit 1
fi

echo "✅ nvm installed successfully"

# Install Node.js stable
echo "📦 Installing Node.js (stable)..."
nvm install node
nvm use node

# Verify Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js installation failed"
    exit 1
fi

echo "✅ Node.js $(node --version) installed successfully"
echo "✅ npm $(npm --version) installed successfully"

# Install Claude Code
echo "📦 Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# Verify Claude Code installation
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code installation failed"
    exit 1
fi

echo "✅ Claude Code installed successfully"

echo ""
echo "🎉 All tools installed successfully!"
echo "=================================================================="
echo "Installed versions:"
echo "- nvm: $(nvm --version)"
echo "- Node.js: $(node --version)"
echo "- npm: $(npm --version)"
echo "- Claude Code: Ready to use"
echo ""
echo "To get started:"
echo "1. Open a new terminal or run: source ~/.bashrc"
echo "2. Navigate to your project directory"
echo "3. Run: claude"
echo ""
echo "Note: If nvm commands don't work immediately, restart your terminal."