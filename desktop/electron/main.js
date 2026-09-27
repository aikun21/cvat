// Electron shell for the CVAT desktop build.
// Starts the local services (Redis, CVAT server, OPA, RQ workers), then shows the CVAT UI.
// Data (SQLite db, media, logs) lives next to the exe in the portable (unzipped) build and in
// the per-user AppData directory when the app was installed, see resolveDataDirs().
const { app, BrowserWindow, dialog, session, shell } = require('electron');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const HOST = '127.0.0.1';
const INIT_TIMEOUT_MS = 15 * 60 * 1000; // first start runs all database migrations
const START_TIMEOUT_MS = 120 * 1000;

let mainWindow = null;
let quitting = false;
const children = new Map(); // name -> ChildProcess

// ---------------------------------------------------------------- paths

function isWritableDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, `.write-test-${process.pid}`);
        fs.writeFileSync(probe, '');
        fs.rmSync(probe);
        return true;
    } catch (_) {
        return false;
    }
}

// Portable build (zip / copied folder): everything is stored in <exe dir>\data, so the whole
// folder can be moved or carried on a USB drive. The installer puts an uninstaller next to the
// exe; installed copies keep their data in AppData, so uninstalling never deletes it.
// A read-only location falls back to AppData as well.
function resolveDataDirs() {
    if (!app.isPackaged) return { portable: false };
    const exeDir = path.dirname(process.execPath);
    const installed = fs.readdirSync(exeDir).some((name) => /^Uninstall .*\.exe$/i.test(name));
    const portableRoot = path.join(exeDir, 'data');
    if (installed || !isWritableDir(portableRoot)) return { portable: false };
    return {
        portable: true,
        electron: path.join(portableRoot, 'electron'),
        cvat: path.join(portableRoot, 'cvat'),
    };
}

// must happen before the app is ready: Electron's own profile (cache, local storage) moves too
const dataDirs = resolveDataDirs();
if (dataDirs.portable) {
    app.setPath('userData', dataDirs.electron);
}

function resolvePaths() {
    if (app.isPackaged) {
        const res = process.resourcesPath;
        return {
            python: path.join(res, 'python', 'python.exe'),
            backend: path.join(res, 'backend'),
            ui: path.join(res, 'ui'),
            staticRoot: path.join(res, 'static'),
            dbTemplate: path.join(res, 'db-template'),
            opaBundle: path.join(res, 'opa-bundle', 'cvat.tar.gz'),
            redis: path.join(res, 'redis', 'redis-server.exe'),
            opa: path.join(res, 'opa', 'opa.exe'),
            data: dataDirs.portable ? dataDirs.cvat : path.join(app.getPath('userData'), 'data'),
        };
    }
    // development: run from the repository (see desktop/README.md)
    const root = path.resolve(__dirname, '..', '..');
    return {
        python: path.join(root, '.venv', 'Scripts', 'python.exe'),
        backend: root,
        ui: path.join(root, 'cvat-ui', 'dist'),
        staticRoot: null,
        dbTemplate: null,
        opaBundle: null,
        redis: path.join(root, 'desktop', 'vendor', 'redis', 'redis-server.exe'),
        opa: path.join(root, 'desktop', 'vendor', 'opa', 'opa.exe'),
        data: path.join(root, 'desktop-data', 'electron'),
    };
}

// ---------------------------------------------------------------- helpers

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, HOST, () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, what) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (quitting) throw new Error('应用正在退出');
        if (await check()) return;
        await sleep(300);
    }
    throw new Error(`等待${what}超时`);
}

function portOpen(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, HOST);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
    });
}

function httpOk(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

function readOrCreateSecret(file) {
    if (fs.existsSync(file)) {
        const value = fs.readFileSync(file, 'utf8').trim();
        if (value) return value;
    }
    const value = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, value);
    return value;
}

function setStatus(text) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)})`)
            .catch(() => {});
    }
}

// ---------------------------------------------------------------- processes

const PID_FILE_NAME = 'pids.json';

// Kill services left over from a previous run that did not shut down cleanly.
function killStaleProcesses(runDir) {
    const pidFile = path.join(runDir, PID_FILE_NAME);
    if (!fs.existsSync(pidFile)) return;
    try {
        const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
        for (const { pid, image } of pids) {
            try {
                const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
                    .toString().toLowerCase();
                if (out.includes(`"${image.toLowerCase()}"`)) {
                    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                }
            } catch (_) { /* process already gone */ }
        }
    } catch (_) { /* corrupted pid file */ }
    fs.rmSync(pidFile, { force: true });
}

function savePids(runDir) {
    const pids = [...children.values()].filter((c) => c.pid)
        .map((c) => ({ pid: c.pid, image: path.basename(c.spawnfile) }));
    fs.writeFileSync(path.join(runDir, PID_FILE_NAME), JSON.stringify(pids));
}

function startProcess(name, command, args, options, logDir, runDir) {
    const log = fs.createWriteStream(path.join(logDir, `${name}.log`), { flags: 'w' });
    const child = spawn(command, args, { ...options, windowsHide: true });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    children.set(name, child);
    savePids(runDir);
    child.on('exit', (code) => {
        children.delete(name);
        if (!quitting && !options.oneShot) {
            quitting = true;
            dialog.showErrorBox('CVAT 服务已退出', `服务“${name}”意外退出（代码 ${code}）。\n日志：${path.join(logDir, `${name}.log`)}`);
            app.quit();
        }
    });
    return child;
}

function runToCompletion(name, command, args, options, logDir, runDir, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = startProcess(name, command, args, { ...options, oneShot: true }, logDir, runDir);
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`${name} 超时`));
        }, timeoutMs);
        child.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`${name} 失败（代码 ${code}），日志：${path.join(logDir, `${name}.log`)}`));
        });
    });
}

function stopAll() {
    for (const child of children.values()) {
        try {
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } catch (_) { /* already gone */ }
    }
    children.clear();
}

async function startServices(paths) {
    // CVAT compares paths after resolving them (path traversal protection), so the data
    // directory must be passed in its final form: AppData may be a junction/symlink or be
    // redirected (e.g. MSIX file system virtualization).
    fs.mkdirSync(paths.data, { recursive: true });
    paths.data = fs.realpathSync.native(paths.data);

    const runDir = path.join(paths.data, 'run');
    const logDir = path.join(paths.data, 'logs');
    for (const dir of [paths.data, runDir, logDir, path.join(paths.data, 'redis')]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    killStaleProcesses(runDir);

    const [redisPort, opaPort, serverPort] = [await getFreePort(), await getFreePort(), await getFreePort()];
    const token = crypto.randomBytes(32).toString('hex');
    const baseUrl = `http://${HOST}:${serverPort}`;

    const env = {
        ...process.env,
        DJANGO_SETTINGS_MODULE: 'cvat.settings.desktop',
        DJANGO_SECRET_KEY: readOrCreateSecret(path.join(paths.data, 'secret_key.txt')),
        DJANGO_LOG_LEVEL: 'INFO',
        CVAT_BASE_DIR: paths.data,
        CVAT_HOST: HOST,
        CVAT_REDIS_INMEM_HOST: HOST,
        CVAT_REDIS_INMEM_PORT: String(redisPort),
        CVAT_OPA_URL: `http://${HOST}:${opaPort}`,
        CVAT_DESKTOP_UI_ROOT: paths.ui,
        CVAT_DESKTOP_TOKEN: token,
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        // OpenBLAS reserves ~60 MB of commit per CPU thread in every process that imports numpy
        // (1.2 GB with 20 threads). Video annotation does not need parallel BLAS.
        OPENBLAS_NUM_THREADS: '1',
        OMP_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
    };
    if (paths.staticRoot) env.CVAT_DESKTOP_STATIC_ROOT = paths.staticRoot;
    if (paths.dbTemplate) env.CVAT_DESKTOP_DB_TEMPLATE = paths.dbTemplate;
    const pyOptions = { cwd: paths.backend, env };

    setStatus('正在启动 Redis……');
    startProcess('redis', paths.redis, [
        '--port', String(redisPort), '--bind', HOST, '--save', '', '--appendonly', 'no',
        '--dir', path.join(paths.data, 'redis'),
    ], { cwd: path.join(paths.data, 'redis') }, logDir, runDir);
    await waitFor(() => portOpen(redisPort), START_TIMEOUT_MS, ' Redis 启动');

    // The server prepares the database itself (template copy on first start, migrations only
    // after an update).
    setStatus('正在启动 CVAT 服务……');
    startProcess('server', paths.python, [
        '-m', 'cvat.desktop.serve', '--host', HOST, '--port', String(serverPort),
    ], pyOptions, logDir, runDir);
    // Permission rules: the installed app ships them as a bundle built with the backend,
    // so OPA is ready without waiting for the server. In development OPA pulls them from
    // the server (as in CVAT's docker setup), since the rules may be edited.
    const opaArgs = ['run', '--server', `--addr=${HOST}:${opaPort}`, '--log-level=error'];
    if (paths.opaBundle) {
        opaArgs.push('--bundle', paths.opaBundle);
    } else {
        opaArgs.push(
            `--set=services.cvat.url=${baseUrl}`,
            '--set=bundles.cvat.service=cvat',
            '--set=bundles.cvat.resource=/api/auth/rules',
            '--set=bundles.cvat.polling.min_delay_seconds=5',
            '--set=bundles.cvat.polling.max_delay_seconds=15',
        );
    }
    startProcess('opa', paths.opa, opaArgs, { cwd: runDir }, logDir, runDir);

    // Normally ready in ~8 s. The first run after unpacking, installing or copying to another drive
    // is much slower: Windows Defender scans each of the ~3000 program files on first read.
    const slowStartHint = setTimeout(() => {
        setStatus('正在启动 CVAT 服务……\n首次运行（或解压、复制到新位置后）Windows 安全中心会检查程序文件，'
            + '大约需要 1 分钟，之后启动约 10 秒。');
    }, 15000);
    // a database created without a template (development) runs all migrations: allow more time
    try {
        await waitFor(() => httpOk(`${baseUrl}/api/server/about`), INIT_TIMEOUT_MS, ' CVAT 服务启动');
    } finally {
        clearTimeout(slowStartHint);
    }

    // Background jobs are not needed to show the UI: Redis initialization and the workers start
    // after the server, so they do not compete with it for CPU and disk while it loads.
    const backgroundReady = runToCompletion(
        'init', paths.python, ['-m', 'cvat.desktop.init', 'redis'], pyOptions, logDir, runDir, INIT_TIMEOUT_MS,
    ).then(() => {
        const workerArgs = (queues) => ['manage.py', 'rqworker', ...queues, '--worker-class', 'cvat.rqworker.SimpleWorker'];
        // video chunks are needed interactively, so they get their own worker
        startProcess('worker-chunks', paths.python, workerArgs(['chunks']), pyOptions, logDir, runDir);
        startProcess('worker-default', paths.python, workerArgs([
            'import', 'export', 'annotation', 'cleaning', 'notifications', 'webhooks', 'quality_reports', 'consensus',
        ]), pyOptions, logDir, runDir);
        startProcess('scheduler', paths.python, [
            'rqscheduler.py', '--host', HOST, '--port', String(redisPort), '-i', '30',
        ], pyOptions, logDir, runDir);
    });
    // surface a failure of the background initialization even if the UI is already shown
    backgroundReady.catch((error) => {
        if (!quitting) {
            quitting = true;
            dialog.showErrorBox('启动失败', `${error.message}\n\n日志目录：${logDir}`);
            app.quit();
        }
    });

    setStatus('正在加载权限策略……');
    await waitFor(() => httpOk(`http://${HOST}:${opaPort}/health?bundles`), START_TIMEOUT_MS, '权限策略加载');

    return { baseUrl, token };
}

// ---------------------------------------------------------------- window

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 960,
        minWidth: 1200,
        minHeight: 720,
        title: 'CVAT 视频标注',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        autoHideMenuBar: true,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    mainWindow.once('ready-to-show', () => mainWindow.maximize());
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('page-title-updated', (event) => event.preventDefault());
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
}

async function boot() {
    createWindow();
    const paths = resolvePaths();
    let backend;
    try {
        backend = await startServices(paths);
    } catch (error) {
        if (!quitting) {
            quitting = true;
            dialog.showErrorBox('启动失败', `${error.message}\n\n日志目录：${path.join(paths.data, 'logs')}`);
            app.quit();
        }
        return;
    }

    // the token logs the window into the local desktop account (see cvat/desktop/auth.py)
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [`${backend.baseUrl}/*`] },
        (details, callback) => {
            callback({ requestHeaders: { ...details.requestHeaders, 'X-CVAT-Desktop-Token': backend.token } });
        },
    );

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(backend.baseUrl)) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });
    if (mainWindow) mainWindow.loadURL(`${backend.baseUrl}/tasks`);
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady().then(boot);
    app.on('before-quit', () => { quitting = true; stopAll(); });
    app.on('window-all-closed', () => app.quit());
}
