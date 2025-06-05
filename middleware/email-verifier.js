const admin = require('../service/admin');

const verifyEmail = async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({status: "Bad Request", description: "Invalid request body. Email is required."});
  }
  
  try {
    let userRecord = await admin.auth().getUserByEmail(email);
    console.log(`Successfully fetched user with uid: ${userRecord.uid}`);
    req.uid = userRecord.uid
  } catch(error) {
    console.log('Error fetching user data:', error);
    if (error.code === "auth/user-not-found") {
      return res.status(404).json({status: "Not Found", description: "Email is not registered with our system."});
    }
    return res.status(500).json({status: "System Error", description: "Unable to verify email."});
  }
  next();
}

module.exports = { 
  verifyEmail 
};