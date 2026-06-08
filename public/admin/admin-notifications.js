// admin-notifications.js - Shared Socket.io notifications for admin pages
(function() {
    // Check if we are on dashboard or citizen-reports page
    const path = window.location.pathname;
    if (path.includes('dashboard') || path.includes('citizen-reports')) {
        return; // Skip: these pages have their own Socket.io connection
    }

    // Dynamic toast container fallback
    if (!document.getElementById('toastContainer')) {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Dynamic toast function fallback
    if (typeof window.toast !== 'function') {
        window.toast = function(msg, type = 'info') {
            const c = document.getElementById('toastContainer');
            if (!c) return;
            const t = document.createElement('div');
            t.className = `toast toast-${type}`;
            t.style.whiteSpace = 'pre-line';
            t.textContent = msg;
            c.appendChild(t);
            setTimeout(() => t.remove(), 5000);
        };
    }

    function playWarningBeep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, ctx.currentTime);
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
            osc.start();
            osc.stop(ctx.currentTime + 0.45);
        } catch(e) {}
    }

    function playAlarmBeep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            osc1.type = 'sawtooth';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(880, ctx.currentTime);
            osc1.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
            osc2.frequency.setValueAtTime(440, ctx.currentTime);
            osc2.frequency.setValueAtTime(330, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
            osc1.start(); osc2.start();
            osc1.stop(ctx.currentTime + 0.55); osc2.stop(ctx.currentTime + 0.55);
        } catch(e) {}
    }

    // Load socket.io.js dynamically
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = function() {
        if (typeof io === 'function') {
            const socket = io();
            socket.emit('join-admin');

            // 1. Session Issue
            socket.on('session-issue-updated', function(data) {
                if (data.status === 'sorunlu') {
                    const notes = data.notes || '';
                    const activeIssues = notes.split('\n').filter(l => l.includes("⚠️ SAHA SORUNU"));
                    const lastIssue = activeIssues.length > 0 ? activeIssues[activeIssues.length - 1] : notes;
                    let cleanedText = lastIssue;
                    const match = lastIssue.match(/⚠️ SAHA SORUNU \([^)]+\):\s*([^|\]]+)/);
                    if (match) {
                        cleanedText = match[1].trim();
                    }
                    const plate = (data.session && data.session.plate) || 'Araç';
                    const neighborhood = (data.session && data.session.neighborhood) || '';
                    
                    toast(`⚠️ İLAÇLAMADA SORUN BİLDİRİLDİ!\n🚐 Araç: ${plate} (${neighborhood})\n🚨 Sorun: ${cleanedText}`, 'warning');
                    playWarningBeep();
                }
            });

            // 2. Speed Violation
            socket.on('admin-speed-violation', function(data) {
                toast(`⚠️ HIZ İHLALİ!\n🚐 Araç: ${data.plate}\n🚀 Hız: ${data.speed} km/s (Sınır 40 km/s)\n👤 Şoför: ${data.driver}`, 'danger');
                playAlarmBeep();
            });

            // 3. New Citizen Report
            socket.on('citizen-report-new', function(data) {
                const lines = (data.notes || '').split('\n');
                const lastIssue = lines[lines.length - 1] || 'Yeni vatandaş ihbarı';
                toast(`📋 YENİ VATANDAŞ İHBARI!\n📍 Mahalle: ${data.neighborhood}\n🧪 Kategori: ${data.category}\n📝 Açıklama: ${lastIssue}`, 'info');
                playWarningBeep();
            });
        }
    };
    document.head.appendChild(script);
})();
