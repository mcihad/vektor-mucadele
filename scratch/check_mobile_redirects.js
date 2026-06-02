const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim\\public\\mobile\\index.html', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('location') || line.includes('href') || line.includes('logout')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
