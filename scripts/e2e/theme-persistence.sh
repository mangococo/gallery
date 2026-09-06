#!/usr/bin/env bash
# 主题持久化 E2E（真重启，两阶段共用同一 userData）：
#   阶段一：17-theme.json 收尾时切到 烛光+暗色；
#   阶段二：用同一 GALLERY_USER_DATA 重启，17-theme-verify.json 断言启动即恢复。
# 用法：scripts/e2e/theme-persistence.sh
set -eu
cd "$(dirname "$0")/../.."

DEMO_ROOT="/tmp/gallery-demo"
WORK="$(mktemp -d)"
OUT="/tmp/gallery-e2e-theme"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$DEMO_ROOT/album-small" ]; then
  echo "==> 生成演示数据"
  node scripts/gen-demo.mjs
  rm -rf "$DEMO_ROOT/album-small"
  cp -R "$DEMO_ROOT/我的旅行" "$DEMO_ROOT/album-small"
fi

echo "==> 构建"
npm run build >/dev/null

run_phase() {
  GALLERY_E2E=1 \
  GALLERY_USER_DATA="$WORK/userdata" \
  GALLERY_E2E_ALBUM="$DEMO_ROOT/album-small" \
  GALLERY_E2E_STEPS="$1" \
  GALLERY_E2E_DIR="$OUT" \
  npx electron . >/dev/null 2>&1
}

echo "==> 阶段一：切换并留下 烛光+暗色"
run_phase scripts/e2e/steps/17-theme.json

echo "==> 阶段二：重启断言恢复"
run_phase scripts/e2e/steps/17-theme-verify.json

echo "PASS: 主题持久化（mode + palette 跨重启保留）"
