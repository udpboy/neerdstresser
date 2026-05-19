#!/bin/bash

echo "[+] Starting Auto-Installer for MSCJS-Brand Methods..."

# 1. Update & Install System Dependencies (Ubuntu/Debian)
echo "[+] Improving system..."
if [ -f /etc/debian_version ]; then
    sudo apt-get update -y
    sudo apt-get install -y software-properties-common curl git screen golang nodejs npm
    # Install dependencies for Puppeteer/Chrome
    sudo apt-get install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
elif [ -f /etc/redhat-release ]; then
    echo "[!] RedHat-based system detected. Attempting yum install..."
    sudo yum update -y
    sudo yum install -y git screen golang nodejs
    # You might need to add specific yum packages for puppeteer if needed
else
    echo "[!] Unsupported OS for auto-dependency installation. Please install git, screen, golang, nodejs manually."
fi

# 2. Check Node.js Version
echo "[+] Checking Node.js version..."
node -v

# 3. Install Node.js Dependencies
echo "[+] Installing Node.js modules..."
npm install
npm install puppeteer-real-browser puppeteer-extra puppeteer-extra-plugin-stealth

# 4. Build Go Flooder
echo "[+] Building Go Flooder binary..."
if command -v go &> /dev/null; then
    go build -o flooder flooder.go
    chmod +x flooder
    echo "[SUCCESS] Flooder compiled."
else
    echo "[ERROR] Go is not installed! Cannot compile flooder.go"
    exit 1
fi

# 5. Final Setup
echo "[+] Setting permissions..."
chmod +x browser.js
chmod +x symetric.js
chmod +x api.js

echo "----------------------------------------------------"
echo "[SUCCESS] Installation Complete!"
echo "----------------------------------------------------"
echo "To start the API Server:"
echo "   node api.js"
echo ""
echo "Or use screen to keep it running:"
echo "   screen -dmS api node api.js"
echo "----------------------------------------------------"
