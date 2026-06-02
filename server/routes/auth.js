const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, saveDatabase } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');

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

module.exports = router;
