#!/bin/bash
set -e

echo "=========================================="
echo "⚡ VoltIQ Oracle Cloud Auto-Installer"
echo "=========================================="

# 1. Update system packages
echo "📦 Updating system packages..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw

# 2. Configure Host Firewall (UFW & iptables for Oracle)
echo "🛡️ Opening firewall ports (80, 443, 3001)..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3001 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

# 3. Install Docker & Docker Compose if not present
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker Engine..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

# 4. Start VoltIQ Backend with Docker Compose
echo "🚀 Building and starting VoltIQ backend container..."
docker compose down 2>/dev/null || true
docker compose up -d --build

# 5. Verify Health Status
echo "🔍 Verifying server health..."
sleep 5
HEALTH_STATUS=$(curl -s http://localhost:3001/health || echo "error")

if [[ $HEALTH_STATUS == *"ok"* ]]; then
    echo ""
    echo "========================================================="
    echo "✅ VoltIQ Backend successfully deployed and active 24/7!"
    echo "📡 Public Endpoint: http://$(curl -s ifconfig.me):3001"
    echo "🔑 Tesla Partner Key: http://$(curl -s ifconfig.me):3001/.well-known/appspecific/com.tesla.3p.public-key.pem"
    echo "🗄️ Database Location: Docker Volume 'voltiq-data' (Persistent)"
    echo "========================================================="
else
    echo "⚠️ Server started. Check logs with: docker compose logs -f"
fi
