const sgMail = require('@sendgrid/mail');
const { generateMessage } = require('../utils/utils');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(email, otp) {
  try {
    let message = await generateMessage(email, otp)
    let result = await sgMail.send(message);
    console.log("Email sent successfully:", result[0].statusCode);
    return result[0].statusCode;
  } catch(error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

module.exports = {
  sendEmail,
};