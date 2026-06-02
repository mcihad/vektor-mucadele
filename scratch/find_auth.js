const fs = require('fs');
const path = require('path');

const adminDir = 'c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim\\public\\admin';
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    const filePath = path.join(adminDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`=== ${file} ===`);
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        if (line.includes('vms_token') || line.includes('vms_user') || line.includes('window.location.href')) {
            console.log(`${idx + 1}: ${line.trim()}`);
        }
    });
});
