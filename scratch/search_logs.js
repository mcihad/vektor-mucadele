const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\burakkazan\\.gemini\\antigravity\\brain\\0bdcde8e-f0b2-4f2f-b4ff-628725c74172\\.system_generated\\logs\\transcript.jsonl';

if (!fs.existsSync(logPath)) {
    console.log("Log file not found at:", logPath);
    process.exit(0);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

console.log("Searching for errors or relevant keywords...");
lines.forEach((line, idx) => {
    if (!line) return;
    if (line.includes('yol verisi') || line.includes('bulunamadı') || line.includes('calculate-route') || line.includes('fetch-streets')) {
        console.log(`Line ${idx + 1}: ${line.slice(0, 300)}...`);
    }
});
