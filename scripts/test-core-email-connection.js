const axios = require('axios');

async function testCoreEmailConnection() {
  // Use localhost:3002 as per .env CORE_PORT
  const CORE_URL = 'http://localhost:3002/api/customer/inventory/test-email-connection?email=abdelrazikehab1@gmail.com';
  console.log(`Testing Core Service at: ${CORE_URL}`);

  try {
    const response = await axios.get(CORE_URL);
    console.log('✅ Success:', response.data);
  } catch (error) {
    console.error('❌ Error calling Core Service:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

testCoreEmailConnection();
