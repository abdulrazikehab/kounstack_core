
const axios = require('axios');
async function check() {
    try {
        const response = await axios.post('https://saeaa.net/auth/email/send', {});
        console.log('Status:', response.status);
    } catch (e) {
        console.log('Error:', e.response?.status || e.message);
        console.log('Data:', e.response?.data);
    }
}
check();
