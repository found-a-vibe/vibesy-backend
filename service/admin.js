const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: "found-a-vibe-non-prod.firebasestorage.app", 
});

module.exports = admin;