# ProfileDesk

ProfileDesk 是一个面向 Windows 与 macOS 的本地多账户隔离浏览器工作台。每个账户使用独立的 Chromium Session 目录，Cookie、缓存、登录状态、站点存储、下载目录和代理配置互不共享。

当前版本：`0.2.5`

## 已实现

- 业务站与账户树形管理、搜索、多选和批量导入。
- IM式业务站分组与账户列表；业务站可折叠，整个侧栏支持图标窄栏/完整展开。
- 批量启动、停止、刷新、清缓存和创建快照。
- 账户行直接删除，以及带主进程二次确认的批量删除；同步清理隔离Profile、下载、快照和已保存凭据。
- Windows若仍占用Chromium Profile文件，账户记录会先安全移除，软件自动重启并在会话加载前完成残留文件清理，不再因`EBUSY`中断删除。
- 每账户独立持久化 Session，不共享 Cookie、缓存或 LocalStorage。
- 内置浏览器视图，主窗口支持自由拖动和缩放。
- 顶部本地网络、强制直连、自定义 HTTP/HTTPS/SOCKS 代理入口。
- 当前窗口后退、前进、刷新、首页和地址栏。
- 当前账户缓存、离线存储、Cookie/站点数据分级清理。
- 逻辑状态快照：Cookie、当前网址、代理与环境设置。
- 加密 `.pdesk` 导出、导入，跨 Windows/macOS 使用用户密码解密。
- 自动登录安全框架：域名白名单、HTTPS限制、系统安全存储、默认不自动提交。
- DNS、TCP 80/443、TLS证书、浏览器线路HTTP状态和耗时检测。
- 崩溃状态记录和标签页地址恢复。
- 可选启动密码；解锁前不加载或返回账户数据，连续错误带临时限速。
- 可配置全局快捷键：显示/隐藏窗口、切换上/下一个运行账户、收起/展开侧栏。
- 可迁移到用户指定的数据目录；迁移在重启后、浏览会话加载前执行。
- 本地JSONL重要操作日志，记录添加、删除、清理、快照、导入导出和设置变更，不记录密码内容。
- 运行账户数量上限、非当前账户闲置自动停止、后台节流与崩溃视图回收，防止浏览实例无限增长。
- 启用启动密码后可执行全数据尽力覆盖删除，并在空白状态下重启。
- 严格的Electron安全默认值：沙箱、上下文隔离、关闭Node集成、限制导航和新窗口。

## 重要边界

ProfileDesk保证本机浏览数据隔离，但不承诺不同账号无法被业务网站关联。网站仍可通过出口IP、设备特征、账号资料和操作行为判断关联。请遵守目标网站条款。

不要在未审计或未签名的测试版本中存放钱包助记词、服务器根凭据或其他不可恢复的高价值秘密。

更完整的信任边界与发布要求见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 本地运行

```bash
npm install --allow-git=all
npm start
```

npm 12默认禁止Git来源依赖；Electron构建链包含固定到官方仓库提交的`@electron/node-gyp`，因此安装命令对本次依赖解析显式启用Git来源。Windows本地还需要安装Git for Windows。

npm 12还会阻止未审批的依赖安装脚本。本项目只在`package.json`中批准固定版本的`electron-winstaller@5.4.0`，用于Windows安装包构建；不要使用全量脚本审批。

无需管理员权限。首次启动会在系统应用数据目录创建配置、Profile、快照与下载目录。

软件设置中可以选择新的数据存放位置。ProfileDesk会在所选文件夹下创建专用的`ProfileDeskData`目录，不会把所选父目录中的其他文件纳入删除范围。迁移会重启软件，并在新会话启动前复制数据、切换位置和清理旧目录。

## 验证

```bash
npm run verify
```

## 构建

Windows：

```bash
npm run dist:win
```

也可以在 Windows 解压目录双击 `build-windows.cmd`，完成后安装包和便携版位于 `release`。

macOS：

```bash
npm run dist:mac
```

该命令同时生成 Intel x64 与 Apple Silicon arm64 两套 macOS DMG。GitHub Actions会把两种架构分别构建并上传，只上传最终DMG，不上传未压缩的`.app`目录、重复ZIP或blockmap：

- `ProfileDesk-macOS-Intel`：Intel处理器Mac。
- `ProfileDesk-macOS-AppleSilicon`：M1/M2/M3/M4等Apple芯片Mac。

按电脑架构下载其中一个即可，不需要同时下载两套。

macOS正式分发需要Apple Developer证书与公证配置；Windows正式分发建议配置代码签名证书。未签名开发包会触发系统安全提醒。

也可以推送到GitHub后运行仓库自带的双平台构建工作流。

构建脚本固定使用`--publish never`：GitHub Actions只生成并上传Artifact，不会因仓库中存在Draft Release而尝试自动发布。正式发布Release时应使用独立、明确授权的发布流程。

Windows 本机不能完成可正常分发的 macOS 签名与公证；可以在 Windows 上把代码推送到 GitHub，然后由工作流的 Windows/macOS 构建机自动生成全部包。

## 数据与清理语义

- 仅清缓存：保留登录。
- 缓存与离线记录：保留Cookie，但删除缓存、IndexedDB、Service Worker与CacheStorage。
- 当前站点数据：删除当前业务站Cookie与站点存储，会退出当前站点。
- 重置环境：删除该账户全部浏览数据，会完全退出。

完整Profile目录不能在浏览器运行时直接复制。本版快照使用Cookie与配置的逻辑快照，避免复制运行中的LevelDB/SQLite文件导致损坏。

“清空并粉碎全部数据”只在已经启用启动密码、密码校验成功、输入指定确认文字并通过系统二次确认后执行。软件会在重启后、任何浏览会话创建前覆盖可写普通文件并递归删除应用专用数据目录。SSD磨损均衡、文件系统快照、杀毒隔离区和系统/云备份可能保留底层副本，因此该功能不承诺法证级不可恢复；高敏感设备仍应使用全盘加密和可信的系统级擦除工具。

## 自动登录

优先复用已有登录会话。只有登录失效时，才会在精确匹配的HTTPS来源上填充凭据。短信、二维码、验证码、2FA和支付确认必须由用户完成。

## 首版停止线

首版不包含云同步、团队权限、验证码绕过、复杂硬件指纹伪造、批量注册和网站风控规避。
