const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pg = require('pg');

// Force pg to parse naive TIMESTAMP columns as UTC
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (val) => {
    if (!val) return null;
    return new Date(val.endsWith('Z') || val.includes('+') ? val : val + 'Z');
});

// .env dosyasından ayarları yükle
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch(e) {
    console.log('⚠️ dotenv modülü bulunamadı, sistem ortam değişkenleri kullanılacak');
}

let dbConnection = null; // Active pg Pool instance
let lastInsertId = 1; // Track last inserted ID dynamically for LAST_INSERT_ROWID fallback

// Helper to convert rows to sql.js format for route files
function objectsToSqlJsFormat(rows) {
    if (!rows || rows.length === 0) return [];
    const columns = Object.keys(rows[0]);
    const values = rows.map(row => columns.map(col => row[col]));
    return [{ columns, values }];
}

// SQL translator from SQLite syntax to PostgreSQL
function translateSqlToPg(sql, params) {
    let pgSql = sql;

    // Convert positional parameters ? to $1, $2, $3...
    if (params && params.length > 0) {
        let index = 1;
        pgSql = pgSql.replace(/\?/g, () => `$${index++}`);
    }

    // Common function translations
    pgSql = pgSql.replace(/datetime\(\s*(['"])now\1\s*,\s*(['"])([^'"]+)\2\s*\)/gi, "CURRENT_TIMESTAMP + INTERVAL '$3'");
    pgSql = pgSql.replace(/datetime\(\s*(['"])now\1\s*\)/gi, "CURRENT_TIMESTAMP");
    pgSql = pgSql.replace(/date\(\s*(['"])now\1\s*,\s*(['"])([^'"]+)\2\s*\)/gi, "(CURRENT_DATE + INTERVAL '$3')");
    pgSql = pgSql.replace(/date\(\s*(['"])now\1\s*\)/gi, "CURRENT_DATE");
    pgSql = pgSql.replace(/date\(([^)]+)\)/gi, "($1)::date");

    // strftime translations to TO_CHAR
    pgSql = pgSql.replace(/strftime\('%m', ([^)]+)\)/gi, "TO_CHAR(($1)::timestamp, 'MM')");
    pgSql = pgSql.replace(/strftime\('%Y', ([^)]+)\)/gi, "TO_CHAR(($1)::timestamp, 'YYYY')");

    // julianday difference translations to extraction in days
    // Pattern: CAST(julianday(A) - julianday(B) AS TYPE)
    pgSql = pgSql.replace(/CAST\(julianday\(([^)]+)\) - julianday\(([^)]+)\) AS (\w+)\)/gi, 
        "(EXTRACT(EPOCH FROM (($1)::timestamp - ($2)::timestamp)) / 86400.0)::$3");
    pgSql = pgSql.replace(/julianday\(([^)]+)\) - julianday\(([^)]+)\)/gi, 
        "(EXTRACT(EPOCH FROM (($1)::timestamp - ($2)::timestamp)) / 86400.0)");

    // Clean up ('now')::timestamp to CURRENT_TIMESTAMP for PostgreSQL
    pgSql = pgSql.replace(/\('now'\)::timestamp/gi, "CURRENT_TIMESTAMP");
    pgSql = pgSql.replace(/'now'::timestamp/gi, "CURRENT_TIMESTAMP");

    // Convert last_insert_rowid()
    pgSql = pgSql.replace(/SELECT last_insert_rowid\(\)/gi, "SELECT LASTVAL() as id");

    return pgSql;
}

// Wrapper for execution layer
const dbWrapper = {
    // exec: Returns results as array of objects in sql.js format
    exec: async function(sql, params = []) {
        // Intercept last_insert_rowid() call
        if (sql.trim().toLowerCase().includes('last_insert_rowid()')) {
            return [{ columns: ['id'], values: [[lastInsertId]] }];
        }

        const pgSql = translateSqlToPg(sql, params);
        try {
            const res = await dbConnection.query(pgSql, params);
            return objectsToSqlJsFormat(res.rows);
        } catch (err) {
            console.error('[PostgreSQL Exec Error]', err.message, 'SQL:', pgSql);
            throw err;
        }
    },

    // run: Executes the query, returns nothing or saves lastInsertId
    run: async function(sql, params = []) {
        let pgSql = translateSqlToPg(sql, params);
        const isInsert = sql.trim().toLowerCase().startsWith('insert');
        
        // For insert queries, retrieve the generated ID
        if (isInsert) {
            pgSql += ' RETURNING id';
        }

        try {
            const res = await dbConnection.query(pgSql, params);
            if (isInsert && res.rows && res.rows[0]) {
                lastInsertId = res.rows[0].id;
            }
        } catch (err) {
            console.error('[PostgreSQL Run Error]', err.message, 'SQL:', pgSql);
            throw err;
        }
    }
};

async function initDatabase() {
    console.log('🔄 Veritabanı başlatılıyor...');
    console.log('🔒 Veritabanı Türü: PURE POSTGRESQL modu aktif.');

    // Bağlantı bilgilerini ortam değişkenlerinden oku
    const pgHost = process.env.PG_HOST || '10.0.0.200';
    const pgPort = parseInt(process.env.PG_PORT || '5432');
    const pgDb = process.env.PG_DATABASE || 'burak';
    const pgUser = process.env.PG_USER || 'burak';
    const pgPass = process.env.PG_PASSWORD || 'Bkazan90.';
    const pgTimeout = parseInt(process.env.PG_CONNECTION_TIMEOUT || '5000');

    console.log(`🔍 Belediye PostgreSQL Sunucusuna bağlanılıyor (${pgHost}:${pgPort})...`);
    const pgPool = new Pool({
        host: pgHost,
        database: pgDb,
        user: pgUser,
        password: pgPass,
        port: pgPort,
        connectionTimeoutMillis: pgTimeout
    });

    try {
        await pgPool.query('SELECT NOW()');
        console.log('✅ Belediye PostgreSQL Veritabanına Başarıyla Bağlanıldı!');
        dbConnection = pgPool;
        
        await createPgTables();
        await seedPgData();
        return dbWrapper;
    } catch (err) {
        console.error(`
❌ [KRİTİK HATA] PostgreSQL sunucusuna bağlanılamadı!
Lütfen .env dosyasındaki bağlantı bilgilerini kontrol edin veya veritabanı sunucusunun açık olduğundan emin olun.
Bağlantı Hatası Detayı: ${err.message}
`);
        await pgPool.end().catch(() => {});
        throw err;
    }
}

// Dummy save function for route compatibility
function saveDatabase() {
    // Write-through to PostgreSQL, no manual file export needed
}

function getDb() {
    return dbWrapper;
}

// ==========================================
// PostgreSQL Schema Creation & Seeding
// ==========================================
async function createPgTables() {
    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            full_name VARCHAR(150) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'field',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id SERIAL PRIMARY KEY,
            plate VARCHAR(50) UNIQUE NOT NULL,
            machine_name VARCHAR(100) NOT NULL,
            machine_type VARCHAR(50) NOT NULL DEFAULT 'ulv',
            tank_capacity_lt DOUBLE PRECISION NOT NULL,
            consumption_info TEXT,
            spray_width_mt DOUBLE PRECISION DEFAULT 10,
            usage_type VARCHAR(100) NOT NULL,
            is_active INTEGER DEFAULT 1,
            last_lat DOUBLE PRECISION,
            last_lng DOUBLE PRECISION,
            last_location_time TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    try {
        await dbConnection.query(`
            ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS device_id VARCHAR(100) UNIQUE
        `);
    } catch(err) {
        console.error('[Migration] vehicles tablosuna device_id kolonu eklenirken hata oluştu:', err.message);
    }

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS planned_routes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(200),
            neighborhood VARCHAR(200) NOT NULL,
            vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
            assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            assigned_personnel_ids TEXT,
            route_geojson TEXT,
            route_coords TEXT,
            total_distance_km DOUBLE PRECISION,
            estimated_time_min DOUBLE PRECISION,
            estimated_chemical_lt DOUBLE PRECISION,
            street_count INTEGER DEFAULT 0,
            route_type VARCHAR(50) DEFAULT 'auto',
            status VARCHAR(50) DEFAULT 'planned',
            planned_date VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS personnel (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(150) NOT NULL,
            role VARCHAR(50) DEFAULT 'operator',
            phone VARCHAR(50),
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS chemicals (
            id SERIAL PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            type VARCHAR(100) NOT NULL,
            unit VARCHAR(50) DEFAULT 'litre',
            stock_amount DOUBLE PRECISION DEFAULT 0,
            min_stock_alert DOUBLE PRECISION DEFAULT 50,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS spray_sessions (
            id SERIAL PRIMARY KEY,
            vehicle_id INTEGER REFERENCES vehicles(id),
            driver_id INTEGER REFERENCES personnel(id),
            operator_id INTEGER REFERENCES personnel(id),
            chemical_id INTEGER REFERENCES chemicals(id),
            route_id INTEGER REFERENCES planned_routes(id),
            neighborhood VARCHAR(200),
            district VARCHAR(100) DEFAULT 'Merkez',
            application_type VARCHAR(100) DEFAULT 'sokak_ilacalama',
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            total_km DOUBLE PRECISION DEFAULT 0,
            chemical_used_lt DOUBLE PRECISION DEFAULT 0,
            area_covered_m2 DOUBLE PRECISION DEFAULT 0,
            status VARCHAR(50) DEFAULT 'planned',
            notes TEXT,
            remaining_chemical_lt DOUBLE PRECISION,
            planned_date DATE DEFAULT CURRENT_DATE,
            work_area_geojson TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS chemical_transactions (
            id SERIAL PRIMARY KEY,
            chemical_id INTEGER REFERENCES chemicals(id) ON DELETE CASCADE,
            transaction_type VARCHAR(50) NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            description TEXT,
            session_id INTEGER REFERENCES spray_sessions(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS route_points (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES spray_sessions(id) ON DELETE CASCADE,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            speed_kmh DOUBLE PRECISION DEFAULT 0,
            is_spraying INTEGER DEFAULT 1
        )
    `);

    await dbConnection.query(`
        ALTER TABLE route_points ADD COLUMN IF NOT EXISTS is_spraying INTEGER DEFAULT 1
    `).catch(err => console.log('is_spraying column already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE planned_routes ADD COLUMN IF NOT EXISTS transport_type VARCHAR(50) DEFAULT 'vehicle'
    `).catch(err => console.log('transport_type column already exists or error:', err.message));

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS sprayed_streets (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES spray_sessions(id) ON DELETE CASCADE,
            street_name VARCHAR(250),
            osm_way_id VARCHAR(100),
            width_mt DOUBLE PRECISION DEFAULT 8,
            pass_count INTEGER DEFAULT 1,
            length_mt DOUBLE PRECISION DEFAULT 0,
            sprayed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            geometry_geojson TEXT
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS neighborhoods (
            id SERIAL PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            district VARCHAR(100) DEFAULT 'Merkez',
            boundary_geojson TEXT,
            total_street_km DOUBLE PRECISION DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS citizen_reports (
            id SERIAL PRIMARY KEY,
            reporter_name VARCHAR(150),
            reporter_phone VARCHAR(50),
            report_type VARCHAR(100) DEFAULT 'haşere',
            description TEXT NOT NULL,
            neighborhood VARCHAR(200),
            address TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            priority VARCHAR(50) DEFAULT 'normal',
            status VARCHAR(50) DEFAULT 'beklemede',
            assigned_session_id INTEGER REFERENCES spray_sessions(id),
            assigned_user_id INTEGER REFERENCES users(id),
            assignment_time TIMESTAMP,
            photo_path VARCHAR(255),
            planned_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP
        )
    `);

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id)
    `).catch(err => console.log('assigned_user_id column already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS assignment_time TIMESTAMP
    `).catch(err => console.log('assignment_time column already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS work_area_geojson TEXT
    `).catch(err => console.log('work_area_geojson column already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS admin_notes TEXT
    `).catch(err => console.log('admin_notes column already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS planned_date DATE
    `).catch(err => console.log('planned_date column already exists in citizen_reports or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE citizen_reports ADD COLUMN IF NOT EXISTS feedback_message TEXT
    `).catch(err => console.log('feedback_message column already exists in citizen_reports or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS intake_chemical_name VARCHAR(255)
    `).catch(err => console.log('intake_chemical_name already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS intake_received_from VARCHAR(255)
    `).catch(err => console.log('intake_received_from already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS intake_amount_lt DOUBLE PRECISION
    `).catch(err => console.log('intake_amount_lt already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS intake_date TIMESTAMP
    `).catch(err => console.log('intake_date already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS intake_chemical_type VARCHAR(100)
    `).catch(err => console.log('intake_chemical_type already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS remaining_chemical_lt DOUBLE PRECISION
    `).catch(err => console.log('remaining_chemical_lt already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS planned_date DATE DEFAULT CURRENT_DATE
    `).catch(err => console.log('planned_date already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE spray_sessions ADD COLUMN IF NOT EXISTS work_area_geojson TEXT
    `).catch(err => console.log('work_area_geojson already exists or error:', err.message));

    await dbConnection.query(`
        ALTER TABLE personnel ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'aktif'
    `).catch(err => console.log('personnel status column already exists or error:', err.message));

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS application_types (
            id SERIAL PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            method VARCHAR(150),
            target_pest VARCHAR(150),
            is_active INTEGER DEFAULT 1
        )
    `);

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS local_streets (
            id SERIAL PRIMARY KEY,
            osm_id VARCHAR(100),
            fid VARCHAR(100),
            name VARCHAR(250),
            highway VARCHAR(100),
            width INTEGER,
            length_m INTEGER,
            mahalle VARCHAR(200),
            geometry_geojson TEXT,
            bbox_minx DOUBLE PRECISION,
            bbox_miny DOUBLE PRECISION,
            bbox_maxx DOUBLE PRECISION,
            bbox_maxy DOUBLE PRECISION
        )
    `);

    await dbConnection.query(`CREATE INDEX IF NOT EXISTS idx_local_streets_bbox ON local_streets(bbox_minx, bbox_maxx, bbox_miny, bbox_maxy)`);
    await dbConnection.query(`CREATE INDEX IF NOT EXISTS idx_local_streets_mahalle ON local_streets(mahalle)`);

    // Push notification subscriptions table
    try {
        const idColCheck = await dbConnection.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'push_subscriptions' AND column_name = 'id'
        `);
        if (idColCheck.rows.length === 0) {
            await dbConnection.query(`DROP TABLE IF EXISTS push_subscriptions`);
        }
    } catch(e) {
        console.log('Error checking columns of push_subscriptions:', e.message);
    }

    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL,
            subscription_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Ensure personnel has status column
    try {
        await dbConnection.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pasif'`);
        await dbConnection.query(`UPDATE personnel SET status = 'pasif'`);
    } catch(e) { /* column may already exist or error */ }

    // Ensure vehicles has tank stock columns
    try {
        await dbConnection.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_chemical_id INTEGER REFERENCES chemicals(id) ON DELETE SET NULL`);
        await dbConnection.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_chemical_amount DOUBLE PRECISION DEFAULT 0`);
    } catch(e) {
        console.log('Error adding tank columns to vehicles table:', e.message);
    }

    // Create vehicle stock transactions table
    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS vehicle_stock_transactions (
            id SERIAL PRIMARY KEY,
            vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
            chemical_id INTEGER REFERENCES chemicals(id) ON DELETE SET NULL,
            transaction_type VARCHAR(50) NOT NULL, -- 'giris', 'cikis'
            amount DOUBLE PRECISION NOT NULL,
            description TEXT,
            received_from VARCHAR(255),
            session_id INTEGER REFERENCES spray_sessions(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Ensure vehicle_stock_transactions has received_from column
    try {
        await dbConnection.query(`ALTER TABLE vehicle_stock_transactions ADD COLUMN IF NOT EXISTS received_from VARCHAR(255)`);
    } catch(e) {
        console.log('Error adding received_from column to vehicle_stock_transactions:', e.message);
    }

    // Create vehicle fuel tracking table
    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
            id SERIAL PRIMARY KEY,
            vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
            driver_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
            fill_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            odometer DOUBLE PRECISION NOT NULL,
            fuel_liters DOUBLE PRECISION NOT NULL,
            price_per_liter DOUBLE PRECISION,
            total_cost DOUBLE PRECISION NOT NULL,
            station_name VARCHAR(255),
            description TEXT,
            fuel_type VARCHAR(100)
        )
    `);

    // Ensure vehicle_fuel_logs has fuel_type column and price_per_liter is optional
    try {
        await dbConnection.query(`ALTER TABLE vehicle_fuel_logs ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(100)`);
        await dbConnection.query(`ALTER TABLE vehicle_fuel_logs ALTER COLUMN price_per_liter DROP NOT NULL`);
    } catch(e) {
        console.log('Error migrating vehicle_fuel_logs columns:', e.message);
    }

    // ─── Kullanıcı Konum Takibi (Sürekli) ───
    // Users tablosuna konum sütunları ekle
    try {
        await dbConnection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION`);
        await dbConnection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION`);
        await dbConnection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_speed DOUBLE PRECISION DEFAULT 0`);
        await dbConnection.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_location_time TIMESTAMP`);
    } catch(e) {
        console.log('Error adding location columns to users:', e.message);
    }

    // Kullanıcı konum geçmişi tablosu - oturum bağımsız, sürekli kayıt
    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS user_location_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            speed DOUBLE PRECISION DEFAULT 0,
            accuracy DOUBLE PRECISION,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // İndeks oluştur - hızlı tarih bazlı sorgular için
    try {
        await dbConnection.query(`CREATE INDEX IF NOT EXISTS idx_user_location_log_user_time ON user_location_log (user_id, recorded_at DESC)`);
    } catch(e) {
        console.log('Error creating user_location_log index:', e.message);
    }

    // Araç takip yorumları tablosu
    await dbConnection.query(`
        CREATE TABLE IF NOT EXISTS vehicle_tracking_comments (
            id SERIAL PRIMARY KEY,
            vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
            period_type VARCHAR(20) NOT NULL,
            period_date VARCHAR(100) NOT NULL,
            source_type VARCHAR(20) NOT NULL,
            comment_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    try {
        await dbConnection.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_comments_unique 
            ON vehicle_tracking_comments (COALESCE(vehicle_id, 0), period_type, period_date, source_type)
        `);
    } catch(e) {
        console.log('Error creating idx_vehicle_comments_unique index:', e.message);
    }
}

async function seedPgData() {
    const res = await dbConnection.query("SELECT COUNT(*) as count FROM vehicles");
    if (parseInt(res.rows[0].count) > 0) return;

    await dbConnection.query(`
        INSERT INTO vehicles (plate, machine_name, machine_type, tank_capacity_lt, consumption_info, spray_width_mt, usage_type) VALUES
        ('58 TD 620', 'Misblower', 'misblower', 200, 'Tank 200lt, 45 dk boşaltır, 10m genişlik', 10, 'sokak_ilacalama'),
        ('58 TD 621', 'ULV', 'ulv', 100, '100lt tankı 22.5 dk''da püskürtür, 20 km/h hız', 10, 'sokak_ilacalama'),
        ('58 TD 622', 'Holder', 'holder', 600, '1 saatte 600lt, tabanca ile 1 dekar 100lt', 0, 'larva_gubre'),
        ('58 TD 623', 'Holder', 'holder', 600, '1 saatte 600lt, tabanca ile 1 dekar 100lt', 0, 'larva_gubre')
    `);

    const personnel = ['Ufuk', 'Ahmet', 'Kamil', 'Alperen', 'Samet', 'Tolga', 'Koray', 'Enes', 'Onur'];
    for (const p of personnel) {
        await dbConnection.query("INSERT INTO personnel (name, role) VALUES ($1, 'operator')", [p]);
    }

    const hashedPw = bcrypt.hashSync('admin123', 10);
    await dbConnection.query("INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4)",
        ['admin', hashedPw, 'Sistem Yöneticisi', 'admin']);

    const fieldPw = bcrypt.hashSync('sivas2024', 10);
    for (const p of personnel) {
        const uname = p.toLowerCase().replace(/ü/g,'u').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i');
        await dbConnection.query("INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4)",
            [uname, fieldPw, p, 'field']);
        await dbConnection.query("UPDATE personnel SET user_id = (SELECT id FROM users WHERE username = $1) WHERE name = $2",
            [uname, p]);
    }

    await dbConnection.query(`
        INSERT INTO chemicals (name, type, stock_amount) VALUES
        ('D-Phenothrin', 'adultisit', 100),
        ('Cypermethrin', 'adultisit', 80),
        ('Temephos', 'larvisit', 60),
        ('Bacillus thuringiensis', 'biyolojik_larvisit', 40),
        ('Deltamethrin', 'adultisit', 90)
    `);

    await dbConnection.query(`
        INSERT INTO application_types (name, description, method, target_pest) VALUES
        ('Sivrisinek Ergin Uygulama', 'ULV veya Misblower ile sokak ilaçlama', 'ULV/Misblower', 'Sivrisinek'),
        ('Sivrisinek Larva Uygulama', 'Su birikintilerinde larva mücadele', 'Holder/Tabanca', 'Sivrisinek Larvası'),
        ('Karasinek Mücadele', 'Gübrelik alan ilaçlama', 'Holder/Tabanca', 'Karasinek'),
        ('Kemirgen Mücadele', 'Fare/kemirgen ilaçlama', 'Manuel', 'Kemirgen'),
        ('Kıslan Mücadelesi', 'Kışlak alan ilaçlama', 'Manuel', 'Çeşitli'),
        ('Dezenfeksiyon Uygulaması', 'Alan dezenfeksiyonu', 'Holder', 'Patojen'),
        ('Fiziksel Mücadele', 'Fiziksel yöntemlerle mücadele', 'Manuel', 'Çeşitli'),
        ('Gözetim/Kontrol', 'Saha gözlemi ve denetim', 'Gözlem', 'Çeşitli')
    `);

    const neighborhoods = [
        'Yenişehir', 'Kılavuz', 'Karşıyaka', 'Alibaba', 'Pulur',
        'Ferhatbostan', 'Paşabey', 'Akdeğirmen', 'Esenyurt', 'Esentepe',
        'Gültepe', 'Mehmet Akif Ersoy', 'Yunusemre', 'Huzur', 'Sanayi',
        'Çarşıbaşı', 'Subaşı', 'Altuntabak', 'Demiryurt', 'Emek'
    ];
    for (const n of neighborhoods) {
        await dbConnection.query("INSERT INTO neighborhoods (name) VALUES ($1)", [n]);
    }
}

module.exports = { initDatabase, getDb, saveDatabase };
