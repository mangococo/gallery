#!/usr/bin/env bash
# 自定义 CSS E2E：预置 userData/theme.css → 启动断言注入生效 → 运行中改写 → 断言热更新。
# 用法：scripts/e2e/custom-css.sh
set -eu
cd "$(dirname "$0")/../.."

DEMO_ROOT="/tmp/gallery-demo"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$DEMO_ROOT/album-small" ]; then
  echo "==> 生成演示数据"
  node scripts/gen-demo.mjs
  rm -rf "$DEMO_ROOT/album-small"
  cp -R "$DEMO_ROOT/我的旅行" "$DEMO_ROOT/album-small"
fi

echo "==> 构建"
npm run build >/dev/null

echo "==> 预置自定义样式 v1（--primary: #5A7D9A）"
mkdir -p "$WORK/userdata"
printf ':root { --primary: #5a7d9a; }\n' > "$WORK/userdata/theme.css"

# 运行中改写 v2，验证 watcher 热更新推送
( sleep 6; printf ':root { --primary: #46698c; }\n' > "$WORK/userdata/theme.css" ) &

GALLERY_E2E=1 \
GALLERY_USER_DATA="$WORK/userdata" \
GALLERY_E2E_ALBUM="$DEMO_ROOT/album-small" \
GALLERY_E2E_STEPS=scripts/e2e/steps/19-custom-css.json \
GALLERY_E2E_DIR=/tmp/gallery-e2e-custom-css \
npx electron . >/dev/null 2>&1

echo "PASS: 自定义 CSS 注入 + 热更新"
