const fetch = globalThis.fetch || require('node-fetch');

async function test() {
    console.log("Logging in as admin...");
    try {
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'admin' })
        });
        
        if (!loginRes.ok) {
            console.error("Login failed:", loginRes.status, await loginRes.text());
            return;
        }
        
        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log("Logged in successfully! Token received.");
        
        console.log("Fetching citizen reports...");
        const reportsRes = await fetch('http://localhost:3000/api/citizen-reports', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!reportsRes.ok) {
            console.error("Fetch reports failed:", reportsRes.status, await reportsRes.text());
            return;
        }
        
        const reports = await reportsRes.json();
        console.log(`Fetched ${reports.length} reports.`);
        if (reports.length === 0) {
            console.log("No reports found to delete!");
            return;
        }
        
        const reportToDelete = reports[0];
        console.log(`Attempting to delete report ID: ${reportToDelete.id} (${reportToDelete.report_type})`);
        
        const deleteRes = await fetch(`http://localhost:3000/api/citizen-reports/${reportToDelete.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log(`Delete Response Status: ${deleteRes.status}`);
        console.log(`Delete Response Type: ${deleteRes.headers.get('content-type')}`);
        const responseText = await deleteRes.text();
        console.log("Delete Response Body:");
        console.log(responseText.substring(0, 1000));
        
    } catch (err) {
        console.error("Error during test:", err);
    }
}

test();
