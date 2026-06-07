const { spawn, spawnSync } = require('child_process');
// Development helper script for concurrent Vite + Electron

let viteProcess;
let electronProcess;
let cleaningUp = false;

function killTree(proc, name) {
  if (!proc || !proc.pid) return;
  console.log(`Terminating ${name}...`);
  if (process.platform === 'win32') {
    // SYNCHRONOUSLY force-kill the whole process tree. The npm/electron commands run
    // through cmd.exe wrappers; if we don't kill them before exiting they sit on a
    // "Terminate batch job (Y/N)?" prompt and orphan — which hangs the terminal forever.
    spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    try { proc.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

function killChildren() {
  killTree(viteProcess, 'Vite development server');
  viteProcess = null;
  killTree(electronProcess, 'Electron process');
  electronProcess = null;
}

function cleanup() {
  if (cleaningUp) return; // run once — avoids the repeated "Cleaning up..." and re-entrancy
  cleaningUp = true;
  console.log('\nCleaning up processes...');
  killChildren();
  console.log('Development environment stopped.');
  process.exit(0);
}

// Handle cleanup on various exit conditions. taskkill is synchronous, so the 'exit' hook
// can still tear down children; cleanup() guards against running more than once.
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', killChildren);

async function startDev() {
  console.log('Starting Vite development server...');

  viteProcess = spawn('npm', ['run', 'dev-server-only'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true
  });

  viteProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[VITE] ${output}`);

    // Wait for Vite to be ready before starting Electron
    // Strip ANSI color codes to match the pattern properly
    const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
    if (cleanOutput.includes('Local:') && !electronProcess) {
      console.log('Vite is ready, starting Electron...');
      global.setTimeout(startElectron, 1000);
    }
  });

  viteProcess.stderr.on('data', (data) => {
    console.error(`[VITE ERROR] ${data.toString()}`);
  });

  viteProcess.on('exit', (code) => {
    console.log(`Vite process exited with code ${code}`);
    if (code === 0) {
      console.log('Vite server stopped normally, shutting down development environment...');
    } else {
      console.log('Vite server crashed or was terminated, shutting down development environment...');
    }
    cleanup();
  });

  viteProcess.on('error', (error) => {
    console.error('Failed to start Vite:', error);
    cleanup();
  });
}

function startElectron() {
  if (electronProcess) return;

  console.log('Starting Electron app...');

  electronProcess = spawn('npm', ['run', 'electron'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development' }
  });

  electronProcess.stdout.on('data', (data) => {
    console.log(`[ELECTRON] ${data.toString()}`);
  });

  electronProcess.stderr.on('data', (data) => {
    console.error(`[ELECTRON ERROR] ${data.toString()}`);
  });

  electronProcess.on('exit', (code) => {
    console.log(`Electron process exited with code ${code}`);
    if (code === 0) {
      console.log('Electron closed normally, shutting down development environment...');
    } else {
      console.log('Electron crashed or was terminated, shutting down development environment...');
    }
    cleanup();
  });

  electronProcess.on('error', (error) => {
    console.error('Failed to start Electron:', error);
    cleanup();
  });
}

// Start the development environment
startDev();