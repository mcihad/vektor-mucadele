const fs = require('fs');
const path = require('path');

function searchDir(dir) {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            searchDir(fullPath);
        } else if (item.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('redirect') || content.includes('/mobile')) {
                console.log(`=== ${fullPath} ===`);
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (line.includes('redirect') || line.includes('/mobile')) {
                        console.log(`${idx + 1}: ${line.trim()}`);
                    }
                });
            }
        }
    });
}

searchDir('c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim\\server');
