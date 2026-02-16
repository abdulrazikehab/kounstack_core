
const axios = require('axios');

async function testAuthSend() {
  const url = 'http://localhost:3001/auth/email/send';
  try {
    const response = await axios.post(url, {
      to: 'abdelrazikehab7@gmail.com',
      subject: 'Test directly from Auth',
      html: '<h1>Hello</h1><p>Testing direct auth call</p>',
      fromName: 'Test Auth'
    });
    console.log('Success:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testAuthSend();
