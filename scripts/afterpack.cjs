/**
 * electron-builder afterPack 钩子：macOS 产物 adhoc 封束签名。
 *
 * 背景（v0.11 发版踩坑）：identity: null 会让 electron-builder 完全跳过签名，
 * .app 只有主可执行文件的链接器 adhoc 签名、没有束级 _CodeSignature/CodeResources
 * 封印。Apple Silicon 上 LaunchServices 打开这种束直接报「已损坏，无法打开」，
 * 而终端直跑二进制一切正常——双击装不上、命令行能跑，极具迷惑性。
 * adhoc 封束（identity `-`）不需要开发者证书，能让未签名应用正常双击打开；
 * 带 Gatekeeper 隔离时退化为可批准的「无法验证开发者」而非「已损坏」。
 */
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  // 封束后自校验，签名缺失直接让构建失败
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' })
}
