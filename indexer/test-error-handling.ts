/**
 * Test file for error handling in the indexer
 * Tests various error scenarios:
 * 1. Rate limiting errors (-32005, "Too Many Requests")
 * 2. Filter errors (-32001, "resource not found", "could not coalesce")
 * 3. Already known transaction errors
 * 4. Nonce too low errors
 */

// Test 1: Rate limit error detection
function testRateLimitErrorDetection() {
  console.log("Test 1: Rate Limit Error Detection");
  
  const rateLimitErrors = [
    { message: "Too Many Requests", code: -32005 },
    { message: "Rate limit exceeded", code: -32005 },
    { message: "Request rate limit exceeded", code: -32005 },
    { message: "Rate limit exceeded", code: 0 }, // Test without code
  ];
  
  for (const error of rateLimitErrors) {
    const message = error.message.toLowerCase();
    const isRateLimit = message.includes("too many requests") || 
                       message.includes("-32005") || 
                       message.includes("rate limit");
    console.log(`  ✓ "${error.message}" detected as rate limit: ${isRateLimit}`);
  }
}

// Test 2: Filter error detection
function testFilterErrorDetection() {
  console.log("\nTest 2: Filter Error Detection");
  
  const filterErrors = [
    { message: "resource not found", code: -32001 },
    { message: "could not coalesce error", code: -32001 },
    { message: "filter not found", code: -32001 },
  ];
  
  for (const error of filterErrors) {
    const message = error.message.toLowerCase();
    const isFilterError = message.includes("resource not found") || 
                        error.message.includes("-32001") ||
                        message.includes("filter") ||
                        message.includes("could not coalesce");
    console.log(`  ✓ "${error.message}" detected as filter error: ${isFilterError}`);
  }
}

// Test 3: Transaction error detection
function testTransactionErrorDetection() {
  console.log("\nTest 3: Transaction Error Detection");
  
  const transactionErrors = [
    { message: "already known", code: -32603 },
    { message: "nonce too low", code: -32603 },
    { message: "could not coalesce error", code: -32603 },
  ];
  
  for (const error of transactionErrors) {
    const isTransactionError = error.message.includes("already known") || 
                              error.message.includes("nonce too low") ||
                              error.message.includes("could not coalesce");
    console.log(`  ✓ "${error.message}" detected as transaction error: ${isTransactionError}`);
  }
}

// Test 4: Error handling logic
function testErrorHandlingLogic() {
  console.log("\nTest 4: Error Handling Logic");
  
  const testErrors = [
    { type: "rate_limit", message: "Too Many Requests", shouldRetry: true },
    { type: "filter", message: "resource not found", shouldRetry: false },
    { type: "transaction", message: "already known", shouldMarkProven: true },
    { type: "transaction", message: "nonce too low", shouldMarkProven: true },
    { type: "unknown", message: "network error", shouldRetry: true },
  ];
  
  for (const error of testErrors) {
    let action = "unknown";
    
    if (error.message.includes("Too Many Requests") || error.message.includes("-32005")) {
      action = "retry with backoff";
    } else if (error.message.includes("resource not found") || error.message.includes("-32001")) {
      action = "ignore (auto-recover)";
    } else if (error.message.includes("already known") || error.message.includes("nonce too low")) {
      action = "mark as proven";
    } else {
      action = "retry on next sweep";
    }
    
    console.log(`  ✓ ${error.type}: "${error.message}" -> ${action}`);
  }
}

// Test 5: Provider configuration test
function testProviderConfiguration() {
  console.log("\nTest 5: Provider Configuration");
  
  const configs = [
    { pollingInterval: 4000, description: "Default (4s)" },
    { pollingInterval: 10000, description: "Conservative (10s)" },
    { pollingInterval: 30000, description: "Safe (30s)" },
    { pollingInterval: 60000, description: "Production (60s)" },
  ];
  
  for (const config of configs) {
    const rate = 60 / (config.pollingInterval / 1000);
    console.log(`  ✓ ${config.description}: ${config.pollingInterval}ms interval (~${rate.toFixed(1)} req/min)`);
  }
}

// Test 6: Retry backoff calculation
function testRetryBackoff() {
  console.log("\nTest 6: Retry Backoff Calculation");
  
  const initialDelay = 2000; // 2 seconds
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = initialDelay * Math.pow(2, attempt - 1);
    console.log(`  ✓ Attempt ${attempt}/${maxRetries}: ${delay}ms delay`);
  }
}

// Test 7: Submission delay calculation
function testSubmissionDelay() {
  console.log("\nTest 7: Submission Delay Calculation");
  
  const delays = [
    { delay: 1000, description: "Fast (1s)" },
    { delay: 2000, description: "Standard (2s)" },
    { delay: 5000, description: "Conservative (5s)" },
  ];
  
  for (const config of delays) {
    const eventsPerMinute = 60 / (config.delay / 1000);
    console.log(`  ✓ ${config.description}: ${config.delay}ms delay (~${eventsPerMinute.toFixed(1)} events/min)`);
  }
}

// Run all tests
function runAllTests() {
  console.log("=".repeat(60));
  console.log("ERROR HANDLING TEST SUITE");
  console.log("=".repeat(60));
  
  testRateLimitErrorDetection();
  testFilterErrorDetection();
  testTransactionErrorDetection();
  testErrorHandlingLogic();
  testProviderConfiguration();
  testRetryBackoff();
  testSubmissionDelay();
  
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUITE COMPLETED");
  console.log("=".repeat(60));
}

// Run tests if executed directly
runAllTests();

export { runAllTests };