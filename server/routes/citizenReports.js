const express = require('express');
const { getDb, saveDatabase } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

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

    // Get all reports with search support
    router.get('/', authMiddleware, async (req, res) => {
        const { status, priority, assigned_user_id, search } = req.query;
        const db = getDb();
        let sql = "SELECT r.*, u.full_name as assigned_user_name FROM citizen_reports r LEFT JOIN users u ON r.assigned_user_id = u.id WHERE 1=1";
        const params = [];
        if (status) { sql += " AND r.status = ?"; params.push(status); }
        if (priority) { sql += " AND r.priority = ?"; params.push(priority); }
        if (assigned_user_id) { sql += " AND r.assigned_user_id = ?"; params.push(assigned_user_id); }
        if (search) {
            sql += " AND (LOWER(r.description) LIKE LOWER(?) OR LOWER(r.neighborhood) LIKE LOWER(?) OR LOWER(r.address) LIKE LOWER(?) OR LOWER(r.reporter_name) LIKE LOWER(?) OR LOWER(COALESCE(u.full_name,'')) LIKE LOWER(?))";
            const s = `%${search}%`;
            params.push(s, s, s, s, s);
        }
        sql += " ORDER BY r.created_at DESC";

        try {
            const result = await db.exec(sql, params);
            res.json(rowsToObjects(result));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Create new report (public endpoint - no auth needed for citizens)
    router.post('/', async (req, res) => {
        const { reporter_name, reporter_phone, report_type, description, neighborhood, address, latitude, longitude, priority } = req.body;
        if (!description) return res.status(400).json({ error: 'Açıklama gerekli' });

        const db = getDb();
        try {
            // ─── Günlük 2 ihbar limiti (telefon numarasına göre) ───
            if (reporter_phone && reporter_phone.trim()) {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayCountResult = await db.exec(
                    "SELECT COUNT(*) as count FROM citizen_reports WHERE reporter_phone = ? AND created_at >= ?",
                    [reporter_phone.trim(), todayStart.toISOString()]
                );
                const todayCount = rowsToObjects(todayCountResult);
                if (todayCount.length > 0 && todayCount[0].count >= 2) {
                    return res.status(429).json({ error: 'Günlük ihbar limitiniz (2) dolmuştur. Lütfen yarın tekrar deneyin.' });
                }
            }

            await db.run(`INSERT INTO citizen_reports (reporter_name, reporter_phone, report_type, description, neighborhood, address, latitude, longitude, priority)
                    VALUES (?,?,?,?,?,?,?,?,?)`,
                [reporter_name, reporter_phone, report_type || 'haşere', description, neighborhood, address, latitude, longitude, priority || 'normal']);
            saveDatabase();
            const result = await db.exec("SELECT last_insert_rowid()");
            const lastId = result[0].values[0][0];
            
            // Socket.io: Notify admins of new citizen report
            if (io) {
                io.to('admin').emit('citizen-report-new', {
                    id: lastId,
                    reporter_name: reporter_name || 'Anonim',
                    report_type: report_type || 'haşere',
                    neighborhood: neighborhood || '',
                    description: description,
                    priority: priority || 'normal',
                    latitude, longitude
                });
            }
            
            res.json({ id: lastId, message: 'İhbarınız alındı. Teşekkür ederiz.' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update report status / assignment / work area
    router.put('/:id', authMiddleware, async (req, res) => {
        const { status, assigned_session_id, priority, assigned_user_id, work_area_geojson, admin_notes } = req.body;
        const db = getDb();
        let sql = "UPDATE citizen_reports SET";
        const sets = [];
        const params = [];

        if (status) { sets.push(" status = ?"); params.push(status); }
        if (assigned_session_id) { sets.push(" assigned_session_id = ?"); params.push(assigned_session_id); }
        if (priority) { sets.push(" priority = ?"); params.push(priority); }
        if (work_area_geojson !== undefined) {
            if (work_area_geojson === null || work_area_geojson === '') {
                sets.push(" work_area_geojson = NULL");
            } else {
                sets.push(" work_area_geojson = ?"); params.push(work_area_geojson);
            }
        }
        if (admin_notes !== undefined) {
            if (admin_notes === null || admin_notes === '') {
                sets.push(" admin_notes = NULL");
            } else {
                sets.push(" admin_notes = ?"); params.push(admin_notes);
            }
        }
        if (assigned_user_id !== undefined) {
            if (assigned_user_id === null || assigned_user_id === '') {
                sets.push(" assigned_user_id = NULL");
                sets.push(" assignment_time = NULL");
                sets.push(" status = 'beklemede'");
            } else {
                sets.push(" assigned_user_id = ?");
                params.push(assigned_user_id);
                sets.push(" assignment_time = datetime('now')");
                sets.push(" status = 'işlemde'");
            }
        }
        if (status === 'çözüldü') { sets.push(" resolved_at = datetime('now')"); }

        if (sets.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });

        sql += sets.join(',') + " WHERE id = ?";
        params.push(req.params.id);

        try {
            await db.run(sql, params);
            saveDatabase();
            
            // Socket.io: Notify on assignment
            if (io && assigned_user_id !== undefined && assigned_user_id !== null && assigned_user_id !== '') {
                io.to(`user-${assigned_user_id}`).emit('citizen-report-assigned', {
                    report_id: parseInt(req.params.id),
                    assigned_user_id: parseInt(assigned_user_id)
                });
            }
            
            // Socket.io: Notify admins on status change or notes change
            if (io) {
                const hasSahaSorunu = admin_notes && admin_notes.includes('⚠️ SAHA SORUNU');
                io.to('admin').emit('citizen-report-updated', {
                    report_id: parseInt(req.params.id),
                    status: status || undefined,
                    assigned_user_id: assigned_user_id !== undefined ? assigned_user_id : undefined,
                    saha_sorunu: hasSahaSorunu ? admin_notes : undefined
                });
            }
            
            res.json({ message: 'İhbar güncellendi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete report (authorized admins only)
    router.delete('/:id', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            await db.run("DELETE FROM citizen_reports WHERE id = ?", [req.params.id]);
            saveDatabase();

            // Socket.io: Notify all clients that a report has been deleted
            if (io) {
                io.emit('citizen-report-deleted', {
                    report_id: parseInt(req.params.id)
                });
            }

            res.json({ message: 'İhbar başarıyla silindi' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get report stats
    router.get('/stats/summary', authMiddleware, async (req, res) => {
        const db = getDb();
        try {
            const total = rowsToObjects(await db.exec("SELECT COUNT(*) as count FROM citizen_reports"));
            const pending = rowsToObjects(await db.exec("SELECT COUNT(*) as count FROM citizen_reports WHERE status = 'beklemede'"));
            const inProgress = rowsToObjects(await db.exec("SELECT COUNT(*) as count FROM citizen_reports WHERE status = 'işlemde'"));
            const resolved = rowsToObjects(await db.exec("SELECT COUNT(*) as count FROM citizen_reports WHERE status = 'çözüldü'"));
            const sorunlu = rowsToObjects(await db.exec("SELECT COUNT(*) as count FROM citizen_reports WHERE status = 'sorunlu'"));
            const byType = rowsToObjects(await db.exec("SELECT report_type, COUNT(*) as count FROM citizen_reports GROUP BY report_type"));
            const byNeighborhood = rowsToObjects(await db.exec("SELECT neighborhood, COUNT(*) as count FROM citizen_reports WHERE neighborhood IS NOT NULL GROUP BY neighborhood ORDER BY count DESC LIMIT 10"));

            res.json({
                total: total[0]?.count || 0,
                pending: pending[0]?.count || 0,
                in_progress: inProgress[0]?.count || 0,
                resolved: resolved[0]?.count || 0,
                sorunlu: sorunlu[0]?.count || 0,
                by_type: byType,
                by_neighborhood: byNeighborhood
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
