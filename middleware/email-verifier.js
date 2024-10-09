const admin = require('../service/admin');

const verifyEmail = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.sendStatus(400).send("Invalid request body. Email is required.");
  }
  try {
    let userRecord = await admin.auth().getUserByEmail(email);
    console.log(`Successfully fetched user with uid: ${userRecord.uid}`);
  } catch(error) {
    console.log('Error fetching user data:', error);
    if (error.code === "auth/user-not-found") {
      return res.status(400).send("Email not registered in Firebase.");
    }
    return res.status(500).send("Error verifying email.");
  }
  next();
}

module.exports = { 
  verifyEmail 
};