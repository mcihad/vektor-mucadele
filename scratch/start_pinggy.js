const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'pinggy_output.txt');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });

console.log('Starting Pinggy SSH Tunnel...');
logStream.write(`Started at ${new Date().toISOString()}\n`);

// Pinggy command: ssh -p 443 -o StrictHostKeyChecking=no -R 80:localhost:3000 public@a.pinggy.io
// Note: We use -tt to force pseudo-terminal allocation so Pinggy prints its URL correctly
const tunnel = spawn('ssh', [
  '-tt',
  '-p', '443',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  '-R', '80:localhost:3000',
  'public@a.pinggy.io'
]);

tunnel.stdout.on('data', (data) => {
  const str = data.toString();
  logStream.write(str);
  
  // Try to find the URL in the output
  const httpMatch = str.match(/https?:\/\/[a-zA-Z0-9.-]+\.pinggy\.(?:link|io)/);
  if (httpMatch) {
    console.log(`FOUND TUNNEL URL: ${httpMatch[0]}`);
    fs.writeFileSync(path.join(__dirname, 'pinggy_url.txt'), httpMatch[0]);
  }
});

tunnel.stderr.on('data', (data) => {
  const str = data.toString();
  logStream.write(`[STDERR] ${str}`);
  
  const httpMatch = str.match(/https?:\/\/[a-zA-Z0-9.-]+\.pinggy\.(?:link|io)/);
  if (httpMatch) {
    console.log(`FOUND TUNNEL URL on STDERR: ${httpMatch[0]}`);
    fs.writeFileSync(path.join(__dirname, 'pinggy_url.txt'), httpMatch[0]);
  }
});

tunnel.on('close', (code) => {
  console.log(`Tunnel process exited with code ${code}`);
  logStream.write(`\nExited with code ${code} at ${new Date().toISOString()}\n`);
});

// Let it run. Since it is running in background, we keep this script alive.
setInterval(() => {
  logStream.write(`[HEARTBEAT] ${new Date().toISOString()}\n`);
}, 10000);
