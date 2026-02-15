
const axios = require('axios');
async function check() {
    try {
        const response = await axios.get('https://saeaa.net/auth');
        console.log('Status:', response.status);
    } catch (e) {
        console.log('Error:', e.response?.status || e.message);
    }
}
check();
