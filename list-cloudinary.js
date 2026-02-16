const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function listAll() {
  console.log('--- Root Folders ---');
  const roots = await cloudinary.api.root_folders();
  console.log(JSON.stringify(roots.folders, null, 2));

  for (const folder of roots.folders) {
    console.log(`--- Subfolders of ${folder.name} ---`);
    try {
      const subs = await cloudinary.api.sub_folders(folder.name);
      console.log(JSON.stringify(subs.folders, null, 2));
    } catch (e) {
      console.error(`Error listing ${folder.name}:`, e.message);
    }
  }
}

listAll().catch(console.error);
