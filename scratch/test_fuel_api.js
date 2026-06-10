async function testApi() {
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

    console.log("\n2. Fetching initial fuel stats...");
    const statsRes = await fetch(`${baseUrl}/api/vehicles/fuel/stats`, { headers });
    const stats = await statsRes.json();
    console.log("Initial stats:", stats);

    console.log("\n3. Fetching vehicles to get a valid vehicle ID...");
    const vehiclesRes = await fetch(`${baseUrl}/api/vehicles`, { headers });
    const vehicles = await vehiclesRes.json();
    if (vehicles.length === 0) {
        console.error("❌ No vehicles found in DB! Cannot proceed with test.");
        return;
    }
    const testVehicle = vehicles[0];
    console.log(`Using vehicle: ${testVehicle.plate} (ID: ${testVehicle.id})`);

    console.log("\n4. Fetching personnel to get a valid driver/personnel ID...");
    const personnelRes = await fetch(`${baseUrl}/api/personnel`, { headers });
    const personnel = await personnelRes.json();
    const testDriver = personnel[0] || null;
    console.log(`Using driver: ${testDriver ? testDriver.name : 'None'} (ID: ${testDriver ? testDriver.id : 'null'})`);

    console.log("\n5. Posting a new fuel log entry...");
    const fuelPayload = {
        vehicle_id: testVehicle.id,
        driver_id: testDriver ? testDriver.id : null,
        odometer: 154000,
        fuel_liters: 45.5,
        price_per_liter: 42.10,
        total_cost: 1915.55,
        station_name: 'Belediye Garajı İstasyonu',
        description: 'Antigravity test fuel insertion'
    };

    const postRes = await fetch(`${baseUrl}/api/vehicles/fuel/logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(fuelPayload)
    });

    const postData = await postRes.json();
    console.log("Post response:", postData);

    console.log("\n6. Fetching fuel stats again...");
    const statsRes2 = await fetch(`${baseUrl}/api/vehicles/fuel/stats`, { headers });
    const stats2 = await statsRes2.json();
    console.log("New stats:", stats2);

    console.log("\n7. Fetching fuel logs...");
    const logsRes = await fetch(`${baseUrl}/api/vehicles/fuel/logs`, { headers });
    const logs = await logsRes.json();
    console.log(`Found ${logs.length} fuel logs. Details of first log:`, logs[0]);

    if (logs.length > 0) {
        const addedLog = logs[0];
        console.log(`\n8. Deleting fuel log with ID: ${addedLog.id}...`);
        const delRes = await fetch(`${baseUrl}/api/vehicles/fuel/logs/${addedLog.id}`, {
            method: 'DELETE',
            headers
        });
        const delData = await delRes.json();
        console.log("Delete response:", delData);

        console.log("\n9. Fetching fuel stats one last time...");
        const statsRes3 = await fetch(`${baseUrl}/api/vehicles/fuel/stats`, { headers });
        const stats3 = await statsRes3.json();
        console.log("Final stats:", stats3);
    }
}

testApi();
