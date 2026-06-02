const fs = require('fs');
const path = require('path');

const walk = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('.git')) {
                results = results.concat(walk(fullPath));
            }
        } else {
            results.push(fullPath);
        }
    });
    return results;
};

const search = () => {
    const root = path.join(__dirname, '..');
    const files = walk(root);
    const query = 'sokak verisi';
    
    files.forEach((file) => {
        if (file.endsWith('.html') || file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.py')) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                if (content.toLowerCase().includes(query)) {
                    console.log(`Found in: ${file}`);
                    const lines = content.split('\n');
                    lines.forEach((line, index) => {
                        if (line.toLowerCase().includes(query)) {
                            console.log(`  Line ${index + 1}: ${line.trim()}`);
                        }
                    });
                }
            } catch (err) {
                // Ignore read errors
            }
        }
    });
};

search();
