const sgMail = require('@sendgrid/mail');
const { generateMessage } = require('../utils/utils');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(email, otp) {
  try {
    let message = await generateMessage(email, otp)
    let result = await sgMail.send(message);
    return result[0].statusCode;
  } catch(error) {
    throw error;
  }
};

module.exports = {
  sendEmail,
};