const { initDatabase, getDb } = require('../server/config/database');

async function test() {
    try {
        await initDatabase();
        const db = getDb();
        
        console.log('--- Database Time & Timezone Info ---');
        const timeRes = await db.exec("SELECT NOW() as now, CURRENT_TIMESTAMP as current_timestamp, CURRENT_setting('TIMEZONE') as tz");
        console.log('Result:', JSON.stringify(timeRes, null, 2));
        
        console.log('--- Vehicles last_location_time ---');
        const vehRes = await db.exec("SELECT id, plate, last_location_time FROM vehicles LIMIT 3");
        console.log('Vehicles:', JSON.stringify(vehRes, null, 2));
        
        process.exit(0);
    } catch (err) {
        console.error('Error during test:', err);
        process.exit(1);
    }
}

test();
