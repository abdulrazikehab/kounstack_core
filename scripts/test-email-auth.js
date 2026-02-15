const axios = require('axios');

async function testAuthEmail() {
  const AUTH_URL = 'http://localhost:3001/auth/email/send';
  console.log(`Testing Auth Service at: ${AUTH_URL}`);

  try {
    const response = await axios.post(AUTH_URL, {
      to: 'abdelrazikehab1@gmail.com', // Replace with user email if needed
      subject: 'Test Email from Core Script',
      html: '<p>This is a test email sent directly via axios script.</p>',
      fromName: 'Core Test Script',
    });

    console.log('✅ Success:', response.data);
  } catch (error) {
    console.error('❌ Error calling Auth Service:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

testAuthEmail();
