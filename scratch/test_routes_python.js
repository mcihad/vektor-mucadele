const path = require('path');
const cp = require('child_process');
const fs = require('fs');

// Mock getPythonCommand from routes.js
function getPythonCommand() {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
        console.log(`[Python Detector] Using custom PYTHON_PATH: ${process.env.PYTHON_PATH}`);
        return process.env.PYTHON_PATH;
    }

    if (process.platform === 'win32') {
        const pathsToTry = [];
        try {
            const usersDir = 'C:\\Users';
            if (fs.existsSync(usersDir)) {
                const users = fs.readdirSync(usersDir);
                for (const user of users) {
                    if (['All Users', 'Default', 'Default User', 'Public', 'desktop.ini'].includes(user)) continue;

                    const pythonDir = path.join(usersDir, user, 'AppData', 'Local', 'Programs', 'Python');
                    if (fs.existsSync(pythonDir)) {
                        const versions = fs.readdirSync(pythonDir);
                        for (const ver of versions) {
                            const pyPath = path.join(pythonDir, ver, 'python.exe');
                            if (fs.existsSync(pyPath)) {
                                pathsToTry.push(pyPath);
                            }
                        }
                    }
                    
                    const pyLauncherPath = path.join(pythonDir, 'Launcher', 'py.exe');
                    if (fs.existsSync(pyLauncherPath)) {
                        pathsToTry.push(pyLauncherPath);
                    }
                }
            }
        } catch (e) {
            console.error('[Python Detector] Error scanning user directories:', e.message);
        }

        const systemWidePaths = [
            'C:\\Windows\\py.exe',
            'C:\\Program Files\\Python312\\python.exe',
            'C:\\Program Files\\Python311\\python.exe',
            'C:\\Program Files\\Python310\\python.exe',
            'C:\\Program Files\\Python39\\python.exe',
            'C:\\Program Files (x86)\\Python312-32\\python.exe',
            'C:\\Program Files (x86)\\Python311-32\\python.exe',
            'C:\\Program Files (x86)\\Python310-32\\python.exe'
        ];
        pathsToTry.push(...systemWidePaths);

        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                console.log(`[Python Detector] Auto-detected Python executable: ${p}`);
                return p;
            }
        }
    }
    return 'python';
}

function fetchLocalStreets(south, west, north, east, neighborhood = '') {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'server', 'services', 'query_streets.py');
        const pythonCmd = getPythonCommand();
        console.log(`[Routes] Spawning Python process: "${pythonCmd}" "${scriptPath}"`);
        const child = cp.spawn(pythonCmd, [scriptPath]);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Python script exited with code ${code}. Stderr: ${stderr}`));
            }
            try {
                const geojson = JSON.parse(stdout);
                if (geojson.error) {
                    return reject(new Error(geojson.error));
                }
                resolve(geojson);
            } catch (err) {
                reject(new Error(`Failed to parse Python output: ${err.message}. Output: ${stdout.slice(0, 200)}`));
            }
        });
        
        child.on('error', (err) => {
            reject(err);
        });
        
        child.stdin.write(JSON.stringify({ south, west, north, east, neighborhood }));
        child.stdin.end();
    });
}

// Test with Şeyh Şamil
console.log("=== STARTING ROUTE PYTHON DETECTOR TEST ===");
fetchLocalStreets(39.750421647482675, 37.04608008616128, 39.788407688027085, 37.09357861531679, "ŞEYH ŞAMİL")
    .then(geojson => {
        console.log("SUCCESS! Got GeoJSON Features count:", geojson.features.length);
        process.exit(0);
    })
    .catch(err => {
        console.error("FAILED with error:", err.message);
        process.exit(1);
    });
