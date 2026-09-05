#!/usr/bin/env bash
# 一键串跑全部 E2E 链路：重新生成演示数据 -> 构建 -> 逐链路运行（每链路重置 userData 保证幂等），
# 汇总 PASS/FAIL。导出链路的产物文件由本脚本复核存在性。
# 用法：scripts/e2e/run-all.sh [GALLERY_DEMO_LARGE，默认 420]
set -u
cd "$(dirname "$0")/../.."

export GALLERY_DEMO_LARGE="${1:-420}"
echo "==> 生成演示数据（大相册 $GALLERY_DEMO_LARGE 张）"
node scripts/gen-demo.mjs || exit 1

echo "==> 构建"
npm run build >/dev/null || exit 1

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# 删除链路会把旅行文件夹从共享演示相册移进废纸篓，故留存 pristine 快照、每链路前还原
PRISTINE="$WORK/pristine-album"
cp -R "/tmp/gallery-demo/我的旅行" "$PRISTINE"
DEMO_ALBUM="/tmp/gallery-demo/我的旅行"   # 与 gen-demo.mjs 的 ROOT 保持一致
if [ ! -d "$DEMO_ALBUM" ]; then
  echo "!! 未找到演示相册目录（gen-demo 失败？）"
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
  rm -rf "$WORK/userdata" "/tmp/gallery-demo/我的旅行"
  mkdir -p "$WORK/userdata" "$WORK/shots-$name"
  cp /tmp/gallery-demo/userdata/gallery.db "$WORK/userdata/gallery.db"
  cp -R "$PRISTINE" "/tmp/gallery-demo/我的旅行"

  ENV_ARGS=(GALLERY_E2E=1
    "GALLERY_USER_DATA=$WORK/userdata"
    "GALLERY_E2E_ALBUM=$DEMO_ALBUM"
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
