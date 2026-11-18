#!/usr/bin/env bash
set -euo pipefail

# Aixuno Tools 单机部署初始化脚本（Ubuntu/Debian, 2C4G 起步即可）
# 用法: sudo bash setup-server.sh
# 约定: API 代码 /opt/aixuno-tools-api, 前端产物 /var/www/aixuno-tools,
#       数据目录 /var/lib/aixuno-tools, 配置 /etc/aixuno-tools/aixuno-tools.env

API_DIR=/opt/aixuno-tools-api
DATA_DIR=/var/lib/aixuno-tools
CONF_DIR=/etc/aixuno-tools
CONF_FILE=$CONF_DIR/aixuno-tools.env

fail() { echo "ERROR: $1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run with sudo"

command -v node >/dev/null || fail "node not installed (need >= 20)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "node >= 20 required, found $(node -v)"
command -v ffmpeg >/dev/null || fail "ffmpeg not installed (apt install ffmpeg)"
command -v certbot >/dev/null || echo "NOTE: certbot not found, TLS cert not configured yet"

echo "[1/6] creating directories"
mkdir -p "$API_DIR" "$DATA_DIR" "$CONF_DIR"
chown -R www-data:www-data "$DATA_DIR"

echo "[2/6] installing API dependencies"
cd "$API_DIR"
if [ ! -f package.json ]; then
  fail "$API_DIR does not contain the API code (upload aixuno-tools-api first)"
fi
npm ci --omit=dev --no-fund --no-audit

echo "[3/6] writing $CONF_FILE"
if [ -f "$CONF_FILE" ]; then
  echo "      keeping existing $CONF_FILE"
else
  SECRET=$(openssl rand -hex 24)
  cat > "$CONF_FILE" <<EOF
PORT=8080
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
SIGN_SECRET=$SECRET
WORKER_CONCURRENCY=1
JOB_TTL_HOURS=24
AI_PROVIDER=selfhosted
PYTHON_BIN=python3
EOF
  chmod 600 "$CONF_FILE"
  echo "      generated random SIGN_SECRET"
fi

if [ "${1:-}" = "--with-ai" ]; then
  echo "[3b/6] installing AI environment (GFPGAN + Real-ESRGAN, CPU)"
  command -v python3 >/dev/null || fail "python3 not installed (apt install python3 python3-pip)"
  python3 -m pip install --upgrade pip >/dev/null
  python3 -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  python3 -m pip install -r "$API_DIR/ai/requirements.txt"
  MODELS_DIR="$API_DIR/ai/models"
  mkdir -p "$MODELS_DIR"
  dl() {
    [ -s "$2" ] || curl -fL -o "$2" "$1" || fail "model download failed: $1"
  }
  dl https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth "$MODELS_DIR/GFPGANv1.4.pth"
  dl https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth "$MODELS_DIR/RealESRGAN_x4plus.pth"
  echo "      AI models ready in $MODELS_DIR"
else
  echo "[3b/6] skipping AI environment (run with --with-ai to install GFPGAN + Real-ESRGAN)"
fi

echo "[4/6] installing systemd service"
cp "$API_DIR/deploy/aixuno-tools-api.service" /etc/systemd/system/aixuno-tools-api.service
systemctl daemon-reload
systemctl enable aixuno-tools-api.service
systemctl restart aixuno-tools-api.service

echo "[5/6] checking API health"
sleep 2
curl -fsS http://127.0.0.1:8080/api/health || fail "API did not answer on :8080"

echo "[6/6] nginx (api.aixuno.com -> local API only; web pages live on GitHub Pages)"
if [ -f "$API_DIR/deploy/nginx-api.aixuno.com.conf" ]; then
  cp "$API_DIR/deploy/nginx-api.aixuno.com.conf" /etc/nginx/sites-available/api.aixuno.com
  ln -sf /etc/nginx/sites-available/api.aixuno.com /etc/nginx/sites-enabled/api.aixuno.com
  nginx -t || fail "nginx config test failed"
  systemctl reload nginx || true
  echo "      nginx api site enabled. If no TLS cert yet run:"
  echo "      certbot --nginx -d api.aixuno.com"
fi

echo
echo "Done. The API now serves https://api.aixuno.com (after DNS + certbot)."
echo "Web pages (restore.aixuno.com / watermark.aixuno.com) deploy automatically via GitHub Pages."
