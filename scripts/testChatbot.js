// Automated chatbot test script - 20 diverse questions
// Properly consumes SSE stream from the chatbot API
// Run with: node scripts/testChatbot.js

import http from 'http';

const TEST_QUESTIONS = [
    // --- Category 1: Direct product enquiries ---
    { id: 1, q: "What is the JB08LJ?", category: "product-lookup", expect: "Should describe the JB08LJ cabinet with specs" },
    { id: 2, q: "Tell me about the SOS603", category: "product-lookup", expect: "Should describe SOS603 product" },
    { id: 3, q: "Do you have a cabinet called RS700Heli?", category: "product-lookup", expect: "Should describe RS700Heli for heli-fuel sample jars" },

    // --- Category 2: Specification queries ---
    { id: 4, q: "What are the dimensions of the JB02HR?", category: "spec-query", expect: "Should return height, width, depth in mm with spacing" },
    { id: 5, q: "How much does the JB10.600LJS weigh?", category: "spec-query", expect: "Should return weight in kg with spacing" },
    { id: 6, q: "What is the IP rating of the JB08FE?", category: "spec-query", expect: "Should return IP rating from specifications" },

    // --- Category 3: Comparison queries ---
    { id: 7, q: "Compare the JB08LJ and JB08FE", category: "comparison", expect: "Should use a markdown table comparing both products" },
    { id: 8, q: "What are the weight differences between JB02HR and JB02R?", category: "comparison", expect: "Should show weights of both, ideally in a table" },

    // --- Category 4: Category/browsing queries ---
    { id: 9, q: "What fire hose cabinets do you have?", category: "category-browse", expect: "Should list multiple fire hose cabinets" },
    { id: 10, q: "Show me your lifejacket storage options", category: "category-browse", expect: "Should list lifejacket storage cabinets" },
    { id: 11, q: "Which cabinets have an IP56 rating?", category: "spec-filter", expect: "Should list multiple IP56 rated cabinets (more than 2)" },

    // --- Category 5: Use-case / application queries ---
    { id: 12, q: "I need a cabinet to store 2x30m fire hoses on a ship", category: "use-case", expect: "Should recommend marine-rated fire hose cabinets" },
    { id: 13, q: "What cabinet would you recommend for storing breathing apparatus?", category: "use-case", expect: "Should recommend BA cabinets" },

    // --- Category 6: Meta / knowledge base queries ---
    { id: 14, q: "How many datasheets do you have?", category: "meta", expect: "Should mention 144 entries and 183 original variants" },
    { id: 15, q: "What product categories do you cover?", category: "meta", expect: "Should list categories like Fire Hose, Fire Extinguisher, etc." },

    // --- Category 7: PDF / link requests ---
    { id: 16, q: "Can I get the PDF datasheet for the JB08LJ?", category: "pdf-request", expect: "Should provide a clickable Supabase storage URL" },

    // --- Category 8: Vague / natural language queries ---
    { id: 17, q: "I'm looking for something waterproof for outdoor use", category: "vague", expect: "Should recommend weatherproof/IP-rated cabinets" },
    { id: 18, q: "What's your best cabinet for a marina?", category: "vague", expect: "Should recommend marine-grade cabinets" },

    // --- Category 9: Edge cases ---
    { id: 19, q: "What colour options are available for your cabinets?", category: "general", expect: "Should mention colour options (red, green, RAL colours, etc.)" },
    { id: 20, q: "Do any of your cabinets come with a heater or insulation option?", category: "general", expect: "Should mention heater/insulation as optional extras where available" },
];

function testQuestion(test) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const postData = JSON.stringify({ query: test.q, history: [] });
        const timeoutMs = 60000; // 60 second timeout

        const options = {
            hostname: 'localhost',
            port: 8080,
            path: '/api/chat/stream',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        let rawData = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            req.destroy();
            resolve({ ...test, status: 'TIMEOUT', error: 'Request timed out after 60s', time: 60000, response: rawData.substring(0, 500) });
        }, timeoutMs);

        const req = http.request(options, (res) => {
            res.setEncoding('utf8');
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                if (timedOut) return;
                clearTimeout(timer);
                const elapsed = Date.now() - startTime;

                // Parse SSE events
                let fullResponse = '';
                let datasheets = [];
                const events = rawData.split('\n');

                for (const line of events) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            if (data.type === 'chunk' && data.text) {
                                fullResponse = data.text;
                            }
                            if (data.type === 'done') {
                                fullResponse = data.text || fullResponse;
                                datasheets = data.datasheets || [];
                            }
                        } catch (e) { }
                    }
                }

                resolve({
                    ...test,
                    status: 'OK',
                    time: elapsed,
                    response: fullResponse,
                    datasheetCount: datasheets.length,
                    datasheets: datasheets.map(d => d.productCode || d.filename),
                    responseLength: fullResponse.length
                });
            });
        });

        req.on('error', (err) => {
            if (timedOut) return;
            clearTimeout(timer);
            resolve({ ...test, status: 'ERROR', error: err.message, time: Date.now() - startTime, response: '' });
        });

        req.write(postData);
        req.end();
    });
}

function analyseResult(result) {
    const issues = [];
    const response = (result.response || '').toLowerCase();

    if (result.status === 'ERROR' || result.status === 'TIMEOUT') {
        issues.push(`💥 ${result.status}: ${result.error}`);
        return issues;
    }

    // Check for "I don't have" error responses
    if (response.includes("i don't have that") || response.includes("i don't have information") || response.includes("i don't have a datasheet")) {
        issues.push('❌ BLOCKED: AI said "I don\'t have that information"');
    }

    // Check for empty/very short responses
    if ((result.responseLength || 0) < 30) {
        issues.push('❌ Response too short (' + (result.responseLength || 0) + ' chars)');
    }

    // Category-specific checks
    switch (result.category) {
        case 'product-lookup':
            if (result.datasheetCount === 0) issues.push('⚠️ No datasheets in panel');
            break;
        case 'spec-query':
            if (!/\d/.test(result.response)) issues.push('⚠️ No numbers in spec response');
            if (!/mm|kg|ip/i.test(result.response)) issues.push('⚠️ No units found (mm/kg/IP)');
            break;
        case 'comparison':
            if (!/\|/.test(result.response)) issues.push('⚠️ No table detected (missing | chars)');
            break;
        case 'spec-filter':
            const codeMatches = (result.response || '').match(/[A-Z]{2,3}[\d.]+[A-Za-z\d]*/g) || [];
            const uniqueCodes = new Set(codeMatches.map(c => c.toUpperCase()));
            if (uniqueCodes.size < 3) issues.push('⚠️ Only ' + uniqueCodes.size + ' products listed (expected 3+)');
            break;
        case 'meta':
            if (!response.includes('144') && !response.includes('183')) issues.push('⚠️ Missing product count (144/183)');
            if (response.includes("don't have")) issues.push('❌ Meta query blocked');
            break;
        case 'pdf-request':
            if (!/https?:\/\//i.test(result.response)) issues.push('❌ No URL found in response');
            if (!response.includes('supabase') && !response.includes('.pdf')) issues.push('⚠️ No PDF link detected');
            break;
        case 'category-browse':
            const browseCodeMatches = (result.response || '').match(/[A-Z]{2,3}[\d.]+[A-Za-z\d]*/g) || [];
            if (browseCodeMatches.length < 2) issues.push('⚠️ Only ' + browseCodeMatches.length + ' products listed');
            break;
    }

    // Check unit spacing
    if (/\d(mm|kg|cm)\b/.test(result.response)) {
        issues.push('⚠️ Missing unit spacing (e.g. "33kg" instead of "33 kg")');
    }

    return issues;
}

async function runAllTests() {
    console.log('='.repeat(80));
    console.log('JOBIRD CHATBOT TEST SUITE — 20 Questions');
    console.log('='.repeat(80));
    console.log('Started:', new Date().toISOString());
    console.log('');

    const results = [];

    for (const test of TEST_QUESTIONS) {
        process.stdout.write(`[${String(test.id).padStart(2)}/20] "${test.q.substring(0, 55).padEnd(55)}" `);
        const result = await testQuestion(test);
        const issues = analyseResult(result);
        result.issues = issues;
        results.push(result);

        const statusIcon = result.status === 'ERROR' || result.status === 'TIMEOUT' ? '💥' : issues.length === 0 ? '✅' : '⚠️';
        const timeStr = String(Math.round(result.time / 1000) + 's').padStart(4);
        console.log(`${statusIcon} ${timeStr} | ${result.responseLength || 0} chars | ${result.datasheetCount || 0} ds`);
        if (issues.length > 0) {
            issues.forEach(i => console.log(`       ${i}`));
        }

        // 2 second pause between questions to not overwhelm the server
        await new Promise(r => setTimeout(r, 2000));
    }

    // Summary
    console.log('');
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const passed = results.filter(r => r.status === 'OK' && r.issues.length === 0).length;
    const warnings = results.filter(r => r.status === 'OK' && r.issues.length > 0).length;
    const errors = results.filter(r => r.status === 'ERROR' || r.status === 'TIMEOUT').length;
    const avgTime = Math.round(results.reduce((sum, r) => sum + (r.time || 0), 0) / results.length / 1000);

    console.log(`✅ Passed:   ${passed}/20`);
    console.log(`⚠️ Warnings: ${warnings}/20`);
    console.log(`💥 Errors:   ${errors}/20`);
    console.log(`⏱️  Avg time: ${avgTime}s`);
    console.log('');

    if (warnings + errors > 0) {
        console.log('DETAILED ISSUES:');
        console.log('-'.repeat(80));
        for (const r of results) {
            if (r.status === 'ERROR' || r.status === 'TIMEOUT' || r.issues.length > 0) {
                console.log(`  [Q${r.id}] "${r.q}"`);
                if (r.status === 'ERROR' || r.status === 'TIMEOUT') console.log(`    💥 ${r.error}`);
                r.issues.forEach(i => console.log(`    ${i}`));
                if (r.response) console.log(`    📝 "${r.response.substring(0, 250)}${r.response.length > 250 ? '...' : ''}"`);
                console.log('');
            }
        }
    }

    // Write detailed results to file
    const fs = await import('fs');
    const report = results.map(r => ({
        id: r.id,
        question: r.q,
        category: r.category,
        expected: r.expect,
        status: r.status,
        timeMs: r.time,
        responseLength: r.responseLength,
        datasheetCount: r.datasheetCount,
        datasheets: r.datasheets,
        issues: r.issues,
        responsePreview: (r.response || '').substring(0, 800)
    }));
    fs.writeFileSync('scripts/test_results.json', JSON.stringify(report, null, 2));
    console.log(`\nDetailed results saved to: scripts/test_results.json`);
}

runAllTests().catch(console.error);
