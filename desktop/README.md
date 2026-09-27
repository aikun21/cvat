# CVAT 视频标注桌面版

基于 [CVAT](https://github.com/cvat-ai/cvat) v2.76.0 的 Windows 桌面应用：原生运行（不需要 Docker），数据库使用 SQLite，界面为中文，只保留视频标注相关功能。

## 架构

```
CVAT 视频标注.exe (Electron, desktop/electron/main.js)
 ├─ redis-server.exe            任务队列与缓存（Redis 7.2 Windows 版）
 ├─ python -m cvat.desktop.serve  准备数据库后启动 CVAT 服务（界面 + API）
 ├─ opa.exe                     权限策略引擎，加载打包时生成的策略包
 └─ 服务就绪后在后台启动：
    ├─ python -m cvat.desktop.init redis   Redis 迁移、定期任务注册
    ├─ rqworker chunks          视频分块（单独进程，避免被导出任务阻塞）
    ├─ rqworker import export … 导入/导出等后台任务
    └─ rqscheduler.py           定期清理任务
```

启动耗时（本机实测，出现任务列表为止）：首次约 11 秒，之后约 12 秒。为此做了：

- **数据库模板**：打包时把约 140 个迁移执行到空库（`staging/db-template`），首次启动直接复制，不再现场迁移（约 20 秒以上）。
- **模式指纹**：`schema.fingerprint` 记录迁移文件列表与依赖版本，未变化时跳过 `migrate` 检查（约 7 秒）；升级后指纹变化会自动迁移。
- **预生成权限策略包**：打包时生成 OPA 策略包，OPA 不必等 CVAT 服务启动后再拉取。
- **服务进程内初始化**：数据库准备在服务进程中完成，少加载一次 Django；后台任务在服务就绪后才启动，避免抢占 CPU。

安装后第一次启动时，Windows Defender 会扫描首次读取的程序文件，可能额外多花一些时间。

- 所有服务只监听 127.0.0.1 的随机端口；退出时全部结束，异常退出残留的进程会在下次启动时清理。
- 自动登录：Electron 每次启动生成随机令牌，只加在自己窗口发出的请求上，后端据此登录本地用户 `desktop`（`cvat/desktop/auth.py`）。
- 数据目录（`resolveDataDirs()`）：
  - **绿色版**（zip 解压 / 复制的文件夹）：`<exe 所在目录>\data\cvat`（SQLite 数据库、视频、缓存、日志 `logs\`）和 `data\electron`（界面缓存），整个文件夹可移动或放到 U 盘。已验证移动到含中文和空格的新路径后，旧任务的视频帧、标注和带图像导出均正常。
  - **安装版**：exe 旁有安装程序生成的 `Uninstall *.exe`，数据放在 `%APPDATA%\CVATDesktop\data`，卸载不会删除数据。程序目录不可写时也使用这里。

## 与原版 CVAT 的主要差异

| 位置 | 内容 |
| --- | --- |
| `cvat/settings/desktop.py` | SQLite、文件缓存代替 Kvrocks、Django 直接发送文件和界面、自动登录 |
| `cvat/desktop/` | 界面静态服务、自动登录中间件、启动初始化 |
| `cvat/urls.py` | 桌面模式下由 Django 提供界面；不注册 AI 模型 (lambda) 接口 |
| `cvat-ui/src/cvat-i18n.ts`, `locales/zh-CN.json` | 界面国际化（i18next），英文原文作为键 |
| `cvat-ui/src/utils/i18n-enums.ts` | 枚举值（作业状态、图形类型等）与服务器进度消息的显示名称 |
| `cvat-ui/src/utils/environment.ts` | `isDesktop`：构建时 `CVAT_DESKTOP=true`，隐藏云存储、组织、AI 模型、分析、质量控制、共识等入口 |

## 开发

```powershell
# Python 3.12 环境（uv 管理的独立 Python）
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r desktop\requirements-windows.txt uv
uv pip install --python .venv\Scripts\python.exe --no-deps desktop\wheels\datumaro-0.3-cp312-cp312-win_amd64.whl

# 前端依赖与构建（桌面模式）
corepack yarn install
cd cvat-ui; $env:CVAT_DESKTOP="true"; node ..\node_modules\webpack-cli\bin\cli.js --config ./webpack.config.js; cd ..

# Redis / OPA
powershell -File desktop\fetch-vendor.ps1

# 运行（数据在 desktop-data\electron）
cd desktop\electron; npm install; npm start
```

后端端到端检查（视频上传 → 分块 → 保存轨迹 → 导出）：`python desktop/tests/video_flow.py <服务地址> <用户名> <密码>`。

## 打包

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

产物在 `desktop\electron\release\`：安装包 `CVATDesktop-Setup-<版本>.exe`，绿色版 `CVATDesktop-<版本>-portable-win-x64.zip`（解压后双击 `CVATDesktop.exe`）。

## 汉化流程

界面字符串用英文原文作为键，没有译文时显示英文。工具在 `desktop/i18n-tools/`：

1. `bash desktop/i18n-tools/run-codemod.sh`：把界面代码中新出现的英文文本包成 `t('...')`（可重复运行）。
2. `node desktop/i18n-tools/extract-keys.js --missing missing.json`：同步 `zh-CN.json` 的键，列出缺失的译文。
3. 在 `desktop/i18n-tools/translations/` 中添加译文，然后 `node desktop/i18n-tools/merge-translations.js`（会检查 `{{占位符}}` 是否保留）。

## datumaro

CVAT 依赖的 datumaro 分支含 C++ 和 Rust 扩展，Windows wheel 由 [aikun21/datumaro](https://github.com/aikun21/datumaro/tree/windows-wheel) 的 GitHub Actions 编译，放在 `desktop/wheels/`。
