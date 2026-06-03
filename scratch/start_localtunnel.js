const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'localtunnel_output.txt');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });

console.log('Starting Localtunnel...');
logStream.write(`Started localtunnel at ${new Date().toISOString()}\n`);

function startLT() {
  logStream.write(`Spawning localtunnel process...\n`);
  // npx localtunnel --port 3000 --local-host 127.0.0.1
  const lt = spawn('npx', ['localtunnel', '--port', '3000', '--local-host', '127.0.0.1'], { shell: true });

  lt.stdout.on('data', (data) => {
    const str = data.toString();
    logStream.write(str);
    console.log(`[LT STDOUT] ${str.trim()}`);
    
    const urlMatch = str.match(/your url is: (https?:\/\/[a-zA-Z0-9.-]+\.loca\.lt)/i);
    if (urlMatch) {
      console.log(`FOUND LT URL: ${urlMatch[1]}`);
      fs.writeFileSync(path.join(__dirname, 'localtunnel_url.txt'), urlMatch[1]);
    }
  });

  lt.stderr.on('data', (data) => {
    const str = data.toString();
    logStream.write(`[LT STDERR] ${str}`);
    console.error(`[LT STDERR] ${str.trim()}`);
  });

  lt.on('close', (code) => {
    logStream.write(`Localtunnel exited with code ${code}. Restarting in 5 seconds...\n`);
    console.log(`Localtunnel exited with code ${code}. Restarting...`);
    setTimeout(startLT, 5000);
  });
}

startLT();

setInterval(() => {
  logStream.write(`[HEARTBEAT] ${new Date().toISOString()}\n`);
}, 10000);
