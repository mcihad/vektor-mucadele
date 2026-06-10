async function testScheduleApi() {
    const baseUrl = 'http://localhost:3000';
    console.log("1. Logging in as admin...");
    
    let loginRes;
    try {
        loginRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });
    } catch(err) {
        console.error("Connection failed! Is the server running? error:", err.message);
        return;
    }

    if (!loginRes.ok) {
        console.error("❌ Login failed:", await loginRes.text());
        return;
    }

    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log("✅ Logged in successfully. Token received.");

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    console.log("\n2. Fetching upcoming schedules...");
    const schRes = await fetch(`${baseUrl}/api/reports/schedule`, { headers });
    if (!schRes.ok) {
        console.error("❌ Failed to fetch schedule:", await schRes.text());
        return;
    }
    const schedule = await schRes.json();
    console.log(`Fetched ${schedule.length} schedule entries.`);
    if (schedule.length > 0) {
        console.log("Details of first entry:", schedule[0]);
        if (schedule[0].hasOwnProperty('id')) {
            console.log("✅ SUCCESS: The 'id' field is present in the schedule data!");
        } else {
            console.error("❌ FAILURE: The 'id' field is missing in the schedule data!");
        }
    } else {
        console.log("No schedule entries found. Please ensure there is sprayed street data in the database.");
    }
}

testScheduleApi();
