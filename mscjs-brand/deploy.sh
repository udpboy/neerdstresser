#!/bin/bash

# Deploy Script to Build Frontend and setup Backend for Production

echo "[+] Starting Deployment Process..."

# 1. Build Frontend
echo "[+] Building Frontend..."
cd frontend2 || exit
# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "    Installing frontend dependencies..."
    npm install
fi

# Build for production using the .env.production variables
npm run build

if [ ! -d "dist" ]; then
    echo "[!] Frontend build failed. 'dist' folder not found."
    exit 1
fi
cd ..

# 2. Prepare Backend Public Directory
echo "[+] Preparing Backend..."
cd backend2 || exit
# Backup public folder if exists (safety)
if [ -d "public" ]; then
    echo "    Backing up existing public folder..."
    mv public public_backup_$(date +%s)
fi

# Create new public folder
mkdir -p public

# 3. Copy Frontend Build to Backend
echo "[+] Moving Frontend Build to Backend..."
cp -r ../frontend2/dist/* public/

echo ""
echo "--------------------------------------------------------"
echo "[SUCCESS] Deployment Ready!"
echo "--------------------------------------------------------"
echo "Instructions to run in Production:"
echo "1. Go to backend2 folder: cd backend2"
echo "2. Install dependencies:  npm install"
echo "3. Use the production env:"
echo "   cp .env.production .env"
echo "   (Edit .env and change JWT_SECRET to something secure!)"
echo "4. Start the server:"
echo "   npm start"
echo "   OR use pm2:"
echo "   pm2 start server.js --name mscjs-backend"
echo "--------------------------------------------------------"
