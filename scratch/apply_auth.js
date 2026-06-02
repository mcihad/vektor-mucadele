const fs = require('fs');
const path = require('path');

const adminDir = 'c:\\Users\\burakkazan\\Desktop\\KazanAİ_Vektör_İlaçlama\\SivasVektorMucadele-Dagitim\\public\\admin';
const files = fs.readdirSync(adminDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
    const filePath = path.join(adminDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (file === 'dashboard.html') {
        const target1 = `const TOKEN=localStorage.getItem('vms_token');\r\nconst USER=JSON.parse(localStorage.getItem('vms_user')||'{}');\r\nif(!TOKEN) window.location.href='/';`;
        const target2 = `const TOKEN=localStorage.getItem('vms_token');\nconst USER=JSON.parse(localStorage.getItem('vms_user')||'{}');\nif(!TOKEN) window.location.href='/';`;
        
        const replacement = `const TOKEN=localStorage.getItem('vms_token');\nconst USER=JSON.parse(localStorage.getItem('vms_user')||'{}');\nif(!TOKEN || USER.role !== 'admin') { localStorage.clear(); window.location.href='/'; }`;
        
        if (content.includes(target1)) {
            content = content.replace(target1, replacement);
            console.log(`Replaced in ${file} (CRLF style)`);
        } else if (content.includes(target2)) {
            content = content.replace(target2, replacement);
            console.log(`Replaced in ${file} (LF style)`);
        } else {
            // Regexp replacement to be completely sure
            const regex = /const\s+TOKEN\s*=\s*localStorage\.getItem\('vms_token'\);\s*const\s+USER\s*=\s*JSON\.parse\(localStorage\.getItem\('vms_user'\)\|\|'\{\}'\);\s*if\(!TOKEN\)\s*window\.location\.href\s*=\s*'\/';/;
            if (regex.test(content)) {
                content = content.replace(regex, replacement);
                console.log(`Replaced via regex in ${file}`);
            } else {
                console.log(`Could not find target in ${file} exactly!`);
            }
        }
    } else {
        const target1 = `const TOKEN = localStorage.getItem('vms_token');\r\nif (!TOKEN) window.location.href = '/';`;
        const target2 = `const TOKEN = localStorage.getItem('vms_token');\nif (!TOKEN) window.location.href = '/';`;
        
        const replacement = `const TOKEN = localStorage.getItem('vms_token');\nconst USER = JSON.parse(localStorage.getItem('vms_user') || '{}');\nif (!TOKEN || USER.role !== 'admin') {\n    localStorage.clear();\n    window.location.href = '/';\n}`;
        
        if (content.includes(target1)) {
            content = content.replace(target1, replacement);
            console.log(`Replaced in ${file} (CRLF style)`);
        } else if (content.includes(target2)) {
            content = content.replace(target2, replacement);
            console.log(`Replaced in ${file} (LF style)`);
        } else {
            const regex = /const\s+TOKEN\s*=\s*localStorage\.getItem\('vms_token'\);\s*if\s*\(!TOKEN\)\s*window\.location\.href\s*=\s*['"]\/['"];/;
            if (regex.test(content)) {
                content = content.replace(regex, replacement);
                console.log(`Replaced via regex in ${file}`);
            } else {
                console.log(`Could not find target in ${file} exactly!`);
            }
        }
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
});
