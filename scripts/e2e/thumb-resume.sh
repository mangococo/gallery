#!/usr/bin/env bash
# 23-thumb-resume：缩略图生成中断后续跑（#4 验收）。
# 两阶段共享同一 userData：A 导入 600 张后即刻退出（队列中断在途中）；
# B 重启后断言 pending 全部续跑补齐、无重复入库。由 run-all.sh 特调。
set -u
cd "$(dirname "$0")/../.."

DEMO_ROOT="/tmp/gallery-demo"   # 与 gen-demo.mjs 的 ROOT 保持一致
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$DEMO_ROOT/album-small" ]; then
  echo "     FAIL（缺 album-small 快照）"
  exit 1
fi

rm -rf "$DEMO_ROOT/我的旅行"
cp -R "$DEMO_ROOT/album-small" "$DEMO_ROOT/我的旅行"
mkdir -p "$WORK/userdata" "$WORK/shots-a" "$WORK/shots-b"
cp "$DEMO_ROOT/userdata/gallery.db" "$WORK/userdata/gallery.db"

echo "---- 23-thumb-resume 阶段 A（导入即退出，制造中断）"
env GALLERY_E2E=1 \
  "GALLERY_USER_DATA=$WORK/userdata" \
  "GALLERY_E2E_ALBUM=$DEMO_ROOT/我的旅行" \
  "GALLERY_E2E_STEPS=scripts/e2e/resume-steps/a-interrupt.json" \
  "GALLERY_E2E_DIR=$WORK/shots-a" \
  npx electron . >"$WORK/a.log" 2>&1
if grep -q "脚本出错\|执行失败" "$WORK/a.log"; then
  echo "     FAIL（阶段 A：$(grep -E '脚本出错|执行失败' "$WORK/a.log" | head -1)）"
  exit 1
fi
grep -E "readyAtQuit" "$WORK/a.log" | head -1 || true

echo "---- 23-thumb-resume 阶段 B（重启续跑补齐）"
env GALLERY_E2E=1 \
  "GALLERY_USER_DATA=$WORK/userdata" \
  "GALLERY_E2E_ALBUM=$DEMO_ROOT/我的旅行" \
  "GALLERY_E2E_STEPS=scripts/e2e/resume-steps/b-resume.json" \
  "GALLERY_E2E_DIR=$WORK/shots-b" \
  npx electron . >"$WORK/b.log" 2>&1
if grep -q "脚本出错\|执行失败" "$WORK/b.log"; then
  echo "     FAIL（阶段 B：$(grep -E '脚本出错|执行失败' "$WORK/b.log" | head -1)，日志: $WORK/b.log）"
  # 保留现场供排查
  trap - EXIT
  exit 1
fi
echo "     PASS（中断 → 重启续跑补齐 600 张）"
