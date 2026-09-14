# 安全模型

ProfileDesk 的目标是本机账户隔离与隐私保护，不是规避网站风控。

## 信任边界

- 每个账户使用独立 Chromium Session 目录，Cookie、缓存、LocalStorage、IndexedDB 与 Service Worker 不跨账户共享。
- 网页运行在开启沙箱、上下文隔离且无 Node.js 权限的 WebContentsView 中。
- 渲染层只能调用预加载脚本公开的固定 IPC 方法，不能访问文件系统或执行任意主进程命令。
- 自动登录密码与代理密码使用 Windows DPAPI 或 macOS Keychain 背后的 Electron `safeStorage` 加密。
- 启动密码仅保存 scrypt 派生摘要；解锁前主进程拒绝账户、浏览器、快照与导入导出请求。
- `.pdesk` 导出包不包含自动登录密码或代理密码；Cookie 与配置使用 scrypt + AES-256-GCM 加密。
- 自动登录只在配置来源完全匹配的 HTTPS 页面填充，永不自动提交；验证码、2FA、二维码和支付确认必须人工完成。

## 不保证的事项

隔离 Session 并不等于网站无法关联账户。相同出口 IP、设备与字体特征、账号资料、支付信息、访问节奏和行为模式仍可能产生关联。

首版不包含云同步、团队共享、验证码绕过、复杂硬件指纹伪造、批量注册或反检测承诺。

启动密码用于防止他人临时打开应用查看账户，不替代 Windows/macOS 登录密码、磁盘加密或系统账户权限。能直接修改本机应用数据的管理员仍可删除配置，因此高价值凭据仍应使用专业密码管理器。

## 发布前要求

- Windows 安装包应使用代码签名证书；macOS 应完成 Developer ID 签名、公证和 Staple。
- 升级 Electron 前先查看安全公告，并运行 `npm run verify`。
- 不要在未审计的开发包中保存助记词、根密钥或其他不可恢复的高价值秘密。
