const { spawn } = require('child_process');
// Development helper script for concurrent Vite + Electron

let viteProcess;
let electronProcess;

function cleanup() {
  console.log('\nCleaning up processes...');

  if (viteProcess) {
    console.log('Terminating Vite development server...');
    if (process.platform === 'win32') {
      // On Windows, use taskkill to properly terminate the process tree
      spawn('taskkill', ['/pid', viteProcess.pid, '/t', '/f'], { shell: true });
    } else {
      viteProcess.kill('SIGTERM');
    }
    viteProcess = null;
  }

  if (electronProcess) {
    console.log('Terminating Electron process...');
    if (process.platform === 'win32') {
      // On Windows, use taskkill to properly terminate the process tree
      spawn('taskkill', ['/pid', electronProcess.pid, '/t', '/f'], { shell: true });
    } else {
      electronProcess.kill('SIGTERM');
    }
    electronProcess = null;
  }

  // Give processes time to clean up before exiting
  setTimeout(() => {
    console.log('Development environment stopped.');
    process.exit(0);
  }, 1000);
}

// Handle cleanup on various exit conditions
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

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