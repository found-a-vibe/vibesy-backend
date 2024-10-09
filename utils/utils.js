const fs = require('fs');
const path = require('path');

async function generateMessage(email, otp) {
  const htmlContent = await getHtmlTemplate();
  const updatedHtmlContent = await replacePlaceholders(htmlContent, otp);
  return {
      to: email,
      from: process.env.SENDGRID_VERIFIED_SENDERS_EMAIL,
      subject: 'Found A Vibe OTP Verification Code',
      html: updatedHtmlContent
    }
}

async function getHtmlTemplate() {
  const filePath = path.resolve(__dirname, '..', 'templates/email-template.html');
  try {
    const htmlContent = await fs.promises.readFile(filePath, 'utf-8');
    return htmlContent;
  } catch (err) {
    console.error('Error reading HTML file:', err);
    return '<strong>Error loading HTML template</strong>'; // Fallback content
  }
}

async function replacePlaceholders(html, otp) {
  return html
    .replace('{{otp}}', otp)
}

module.exports = {
  generateMessage
}