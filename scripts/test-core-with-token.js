const axios = require('axios');
const jwt = require('jsonwebtoken');

async function testCoreEmailWithToken() {
  const CORE_URL = 'http://localhost:3002/api/customer/inventory/test-email-connection';
  const SECRET = 'QD6?tCYYNYYRkFduJ&qhapVtA6MgZ*A?'; // From .env
  
  // Create a dummy token for a customer
  const token = jwt.sign({
    sub: 'test-user-id',
    email: 'abdelrazikehab1@gmail.com',
    role: 'CUSTOMER',
    tenantId: 'default-tenant', // Or any valid tenant on your local
    type: 'customer'
  }, SECRET, { expiresIn: '1h' });

  console.log(`Testing Core Service at: ${CORE_URL}`);
  console.log(`Using Token: ${token.substring(0, 20)}...`);

  try {
    const response = await axios.get(CORE_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Tenant-Id': 'default-tenant' 
      },
      params: {
        email: 'abdelrazikehab1@gmail.com' // Explicitly pass email too
      }
    });

    console.log('✅ Success:', response.data);
  } catch (error) {
    console.error('❌ Error calling Core Service:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

testCoreEmailWithToken();
