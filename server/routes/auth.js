const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, saveDatabase } = require('../config/database');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');

function rowsToObjects(result) {
    if (!result || result.length === 0) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
    });
}

module.exports = function(io) {
    const router = express.Router();

    // Login
    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
        }

        const db = getDb();
        let result;
        try {
            result = await db.exec("SELECT * FROM users WHERE username = ? AND is_active = 1", [username]);
        } catch (err) {
            return res.status(500).json({ error: 'Veritabanı hatası: ' + err.message });
        }

        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
        }

        const cols = result[0].columns;
        const row = result[0].values[0];
        const user = {};
        cols.forEach((c, i) => user[c] = row[i]);

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // ─── Giriş yapınca bağlı personeli AKTİF yap ───
        try {
            const personnelResult = await db.exec("SELECT id FROM personnel WHERE user_id = ?", [user.id]);
            const personnelRows = rowsToObjects(personnelResult);
            if (personnelRows.length > 0) {
                await db.run("UPDATE personnel SET status = 'aktif' WHERE user_id = ?", [user.id]);
                saveDatabase();
                console.log(`[Auth] Kullanıcı #${user.id} (${user.username}) giriş yaptı → Personel AKTİF`);
                // Admin'lere bildir
                if (io) {
                    io.to('admin').emit('personnel-status-changed', {
                        user_id: user.id,
                        personnel_id: personnelRows[0].id,
                        username: user.username,
                        full_name: user.full_name,
                        status: 'aktif'
                    });
                }
            }
        } catch (e) {
            console.error('[Auth] Personel aktif yapılamadı:', e.message);
        }

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role
            }
        });
    });

    // ─── Logout: Çıkış yapınca personeli PASİF yap ───
    router.post('/logout', authMiddleware, async (req, res) => {
        const userId = req.user.id;
        const db = getDb();
        try {
            // Personeli pasif yap
            const personnelResult = await db.exec("SELECT id FROM personnel WHERE user_id = ?", [userId]);
            const personnelRows = rowsToObjects(personnelResult);
            if (personnelRows.length > 0) {
                await db.run("UPDATE personnel SET status = 'pasif' WHERE user_id = ?", [userId]);
                console.log(`[Auth] Kullanıcı #${userId} (${req.user.username}) çıkış yaptı → Personel PASİF`);
                // Admin'lere bildir
                if (io) {
                    io.to('admin').emit('personnel-status-changed', {
                        user_id: userId,
                        personnel_id: personnelRows[0].id,
                        username: req.user.username,
                        full_name: req.user.full_name,
                        status: 'pasif'
                    });
                }
            }
            saveDatabase();
            res.json({ message: 'Başarıyla çıkış yapıldı' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── Kullanıcı Listesi (Personel yönetimi için) ───
    router.get('/users', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            const result = await db.exec("SELECT id, username, full_name, role, is_active FROM users ORDER BY username");
            res.json(rowsToObjects(result));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Register (admin only in practice)
    router.post('/register', async (req, res) => {
        const { username, password, full_name, role } = req.body;
        if (!username || !password || !full_name) {
            return res.status(400).json({ error: 'Tüm alanlar gerekli' });
        }

        const db = getDb();
        const hashedPw = bcrypt.hashSync(password, 10);

        try {
            await db.run("INSERT INTO users (username, password, full_name, role) VALUES (?,?,?,?)",
                [username, hashedPw, full_name, role || 'field']);
            saveDatabase();
            res.json({ message: 'Kullanıcı oluşturuldu' });
        } catch (err) {
            res.status(400).json({ error: 'Kullanıcı adı zaten mevcut veya veritabanı hatası' });
        }
    });

    return router;
};
