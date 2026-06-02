const fs = require('fs');
const path = require('path');
const logPath = 'C:\\Users\\burakkazan\\.gemini\\antigravity\\brain\\0bdcde8e-f0b2-4f2f-b4ff-628725c74172\\.system_generated\\logs\\transcript.jsonl';

if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    lines.forEach(line => {
        if (!line) return;
        try {
            const data = JSON.parse(line);
            if (data.step_index >= 1110 && data.step_index <= 1135) {
                console.log(`Step ${data.step_index} (${data.type}):`);
                if (data.thinking) console.log("Thinking:", data.thinking);
                if (data.content) console.log("Content:", data.content.slice(0, 500));
                console.log("------------------------");
            }
        } catch(e) {}
    });
}
