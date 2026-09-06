#!/usr/bin/env bash
# 一键串跑全部 E2E 链路：生成演示数据 -> 构建 -> 逐链路运行（每链路重置 userData 保证幂等），
# 汇总 PASS/FAIL。导出链路的产物文件由本脚本复核存在性。
# 用法：scripts/e2e/run-all.sh [GALLERY_DEMO_LARGE，默认 420]
#
# 演示库设计为空库（应用启动靠增量扫描从磁盘发现旅行）。若 420 张的大相册旅行
# 在 readdir 序里排在前面，扫描会把它前面的时间都吃掉，后续旅行入库延迟数秒——
# 各链路等待窗口短，会随机「找不到旅行」。故生成两份相册快照：
# 小相册服务绝大多数链路，420 大相册仅给 08-large-album 使用。
set -u
cd "$(dirname "$0")/../.."

LARGE="${1:-420}"

echo "==> 生成演示数据（小相册）"
rm -rf "/tmp/gallery-demo/我的旅行" "/tmp/gallery-demo/userdata"
node scripts/gen-demo.mjs || exit 1
rm -rf /tmp/gallery-demo/album-small
cp -R "/tmp/gallery-demo/我的旅行" /tmp/gallery-demo/album-small

if [ "$LARGE" -gt 0 ]; then
  echo "==> 生成演示数据（大相册 $LARGE 张）"
  rm -rf "/tmp/gallery-demo/我的旅行" "/tmp/gallery-demo/userdata"
  GALLERY_DEMO_LARGE="$LARGE" node scripts/gen-demo.mjs || exit 1
  rm -rf /tmp/gallery-demo/album-large
  cp -R "/tmp/gallery-demo/我的旅行" /tmp/gallery-demo/album-large
fi

echo "==> 构建"
npm run build >/dev/null || exit 1

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DEMO_ROOT="/tmp/gallery-demo"   # 与 gen-demo.mjs 的 ROOT 保持一致
if [ ! -d "$DEMO_ROOT/album-small" ]; then
  echo "!! 未找到演示相册快照（gen-demo 失败？）"
  exit 1
fi

STEPS_DIR="scripts/e2e/steps"
PASS=0
FAIL=0
FAILED_LIST=""

for f in "$STEPS_DIR"/*.json; do
  name="$(basename "$f" .json)"
  # HEIC 链路依赖 sips，仅 macOS 跑
  if [ "$name" = "09-heic-chain" ] && [ "$(uname -s)" != "Darwin" ]; then
    echo "---- $name: SKIP（非 macOS）"
    continue
  fi
  echo "---- $name"
  # 08 用大相册（性能验收），其余用小相册（启动扫描 <1s，链路时序稳定）
  if [ "$name" = "08-large-album" ] && [ -d "$DEMO_ROOT/album-large" ]; then
    PRISTINE="$DEMO_ROOT/album-large"
  else
    PRISTINE="$DEMO_ROOT/album-small"
  fi
  rm -rf "$WORK/userdata" "$DEMO_ROOT/我的旅行"
  mkdir -p "$WORK/userdata" "$WORK/shots-$name"
  cp "$DEMO_ROOT/userdata/gallery.db" "$WORK/userdata/gallery.db"
  cp -R "$PRISTINE" "$DEMO_ROOT/我的旅行"

  ENV_ARGS=(GALLERY_E2E=1
    "GALLERY_USER_DATA=$WORK/userdata"
    "GALLERY_E2E_ALBUM=$DEMO_ROOT/我的旅行"
    "GALLERY_E2E_STEPS=$f"
    "GALLERY_E2E_DIR=$WORK/shots-$name")
  if [ "$name" = "07-export-journal" ]; then
    rm -rf "$WORK/exports"
    mkdir -p "$WORK/exports"
    ENV_ARGS+=("GALLERY_E2E_EXPORT_DIR=$WORK/exports")
  fi

  OUT="$WORK/$name.log"
  env "${ENV_ARGS[@]}" npx electron . >"$OUT" 2>&1
  if grep -q "脚本出错\|执行失败" "$OUT"; then
    echo "     FAIL（详细日志: ${OUT}）"
    grep -E "脚本出错|执行失败" "$OUT" | head -3
    FAIL=$((FAIL + 1))
    FAILED_LIST="$FAILED_LIST $name"
  else
    SHOTS=$(ls "$WORK/shots-$name" | wc -l | tr -d ' ')
    # 截图为 0 说明应用根本没跑起来（如单实例锁被占导致秒退），不能算 PASS
    if [ "$SHOTS" -eq 0 ]; then
      echo "     FAIL（0 截图，应用未运行？日志: ${OUT}）"
      FAIL=$((FAIL + 1))
      FAILED_LIST="$FAILED_LIST $name"
      continue
    fi
    if [ "$name" = "07-export-journal" ]; then
      N_FILES=$(ls "$WORK/exports" | wc -l | tr -d ' ')
      if [ "$N_FILES" -lt 2 ]; then
        echo "     FAIL（导出产物不足 2 个）"
        FAIL=$((FAIL + 1))
        FAILED_LIST="$FAILED_LIST $name"
        continue
      fi
      echo "     PASS 截图=$SHOTS 导出=$N_FILES"
    else
      echo "     PASS 截图=$SHOTS"
    fi
    PASS=$((PASS + 1))
  fi
done

echo ""
echo "==> 结果 PASS=$PASS FAIL=$FAIL $FAILED_LIST"
[ "$FAIL" -eq 0 ]
