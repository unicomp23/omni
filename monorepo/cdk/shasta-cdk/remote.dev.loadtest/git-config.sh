#!/bin/bash

# Git configuration script for John Davis
echo "Setting up Git configuration..."

# Set user name
git config --global user.name "John Davis"
echo "✅ Set user.name to: John Davis"

# Set user email
git config --global user.email "john.davis@cantina.ai"
echo "✅ Set user.email to: john.davis@cantina.ai"

# Optional: Set default branch name to main
git config --global init.defaultBranch main
echo "✅ Set default branch to: main"

# Optional: Set up some useful aliases
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.unstage 'reset HEAD --'
git config --global alias.last 'log -1 HEAD'
git config --global alias.visual '!gitk'
echo "✅ Set up useful Git aliases"

# Display current configuration
echo ""
echo "📋 Current Git configuration:"
echo "Name: $(git config --global user.name)"
echo "Email: $(git config --global user.email)"
echo "Default branch: $(git config --global init.defaultBranch)"

echo ""
echo "🎉 Git configuration completed!" 