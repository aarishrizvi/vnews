const testClaims = [
  {
    claim: "Ali Khamenei has died",
    expectedVerdict: "FALSE", // Since news says he is alive or rumors are unconfirmed/false
  },
  {
    claim: "The sky is made of green cheese",
    expectedVerdict: "INSUFFICIENT EVIDENCE", // Likely no news coverage
  },
  {
    claim: "Joe Biden resigned from presidency today",
    expectedVerdict: "FALSE",
  },
  {
    claim: "Hamas leader Yahya Sinwar was killed by IDF",
    expectedVerdict: "TRUE", // True historically in late 2024
  },
  {
    claim: "A new covid variant is causing lockdowns in New York",
    expectedVerdict: "FALSE",
  }
];

async function runTests() {
  for (const test of testClaims) {
    console.log(`\nTesting claim: "${test.claim}"`);
    console.log(`Expected: ${test.expectedVerdict}`);
    
    try {
      const response = await fetch('http://localhost:3000/api/verify/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: test.claim })
      });
      
      const text = await response.text();
      const lines = text.split('\n\n');
      
      let finalResult = null;
      for (const line of lines) {
        if (line.startsWith('event: final_result')) {
          const dataStr = line.replace('event: final_result\ndata: ', '');
          if (dataStr) {
             finalResult = JSON.parse(dataStr);
          }
        }
      }
      
      if (finalResult) {
        console.log(`Actual: ${finalResult.verdict} (Confidence: ${finalResult.confidence})`);
        console.log(`Status: ${finalResult.status}`);
        console.log(`Analysis: ${finalResult.analysis.substring(0, 80)}...`);
        console.log(`Evidence: ${finalResult.metadata?.sourcesQualified} qualified / ${finalResult.metadata?.sourcesChecked} checked`);
        
        if (finalResult.verdict === test.expectedVerdict) {
          console.log('✅ PASS');
        } else {
          console.log('❌ FAIL');
        }
      } else {
        console.log('❌ FAILED TO GET FINAL RESULT');
      }
    } catch (e) {
      console.error('❌ ERROR:', e.message);
    }
  }
}

// NOTE: To run this script, the Next.js development server must be running.
console.log('Evaluation dataset created. Run Next.js server and execute this script to test.');
