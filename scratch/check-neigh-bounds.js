const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.PG_HOST || '10.0.0.200',
    database: process.env.PG_DATABASE || 'burak',
    user: process.env.PG_USER || 'burak',
    password: process.env.PG_PASSWORD || 'Bkazan90.',
    port: parseInt(process.env.PG_PORT || '5432'),
});

function normalizeTurkish(s) {
    if (!s) return "";
    const mapping = {
        'I': 'i', 'İ': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ç': 'c', 'ç': 'c',
        'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u'
    };
    const res = [];
    for (let i = 0; i < s.length; i++) {
        const c = s[i].toUpperCase();
        if (mapping[c]) {
            res.push(mapping[c]);
        } else {
            res.push(c.toLowerCase());
        }
    }
    return res.join('').replace(/[^a-z0-9]/gi, '');
}

async function main() {
    try {
        const res = await pool.query(
            "SELECT mahalle FROM local_streets WHERE fid = '14031'"
        );
        const row = res.rows[0];
        console.log("Database row.mahalle raw:", JSON.stringify(row.mahalle));
        console.log("Database row.mahalle normalized:", normalizeTurkish(row.mahalle));
        console.log("Target 'AHMET TURANGAZİ' normalized:", normalizeTurkish('AHMET TURANGAZİ'));
        console.log("Do they match?", normalizeTurkish(row.mahalle) === normalizeTurkish('AHMET TURANGAZİ'));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
