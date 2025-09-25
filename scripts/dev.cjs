const { spawn } = require('child_process');
const { createRequire } = require('module');
const require = createRequire(import.meta.url);

let viteProcess;
let electronProcess;

function cleanup() {
  console.log('\nCleaning up processes...');

  if (viteProcess) {
    viteProcess.kill();
    viteProcess = null;
  }

  if (electronProcess) {
    electronProcess.kill();
    electronProcess = null;
  }

  process.exit(0);
}

// Handle cleanup on various exit conditions
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

async function startDev() {
  console.log('Starting Vite development server...');

  viteProcess = spawn('npm', ['run', 'dev'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  viteProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[VITE] ${output}`);

    // Wait for Vite to be ready before starting Electron
    if (output.includes('Local:') && !electronProcess) {
      console.log('Vite is ready, starting Electron...');
      setTimeout(startElectron, 1000);
    }
  });

  viteProcess.stderr.on('data', (data) => {
    console.error(`[VITE ERROR] ${data.toString()}`);
  });

  viteProcess.on('exit', (code) => {
    console.log(`Vite process exited with code ${code}`);
    cleanup();
  });
}

function startElectron() {
  if (electronProcess) return;

  console.log('Starting Electron app...');

  electronProcess = spawn('npm', ['run', 'electron'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  electronProcess.stdout.on('data', (data) => {
    console.log(`[ELECTRON] ${data.toString()}`);
  });

  electronProcess.stderr.on('data', (data) => {
    console.error(`[ELECTRON ERROR] ${data.toString()}`);
  });

  electronProcess.on('exit', (code) => {
    console.log(`Electron process exited with code ${code}`);
    cleanup();
  });
}

// Start the development environment
startDev();