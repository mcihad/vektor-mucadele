const jwt = require('jsonwebtoken');
const JWT_SECRET = 'sivas-vms-2024-secret-key';

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Yetkilendirme gerekli' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekli' });
    }
    next();
}

module.exports = { authMiddleware, adminOnly, JWT_SECRET };
