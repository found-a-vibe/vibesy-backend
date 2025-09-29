import sgMail from '@sendgrid/mail';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApiError } from '../utils/errors';

interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, any>;
}

interface OTPEmailData {
  recipientName?: string;
  otp: string;
  expiryMinutes?: number;
}

interface EmailResponse {
  messageId: string;
  statusCode: number;
}

class EmailService {
  private initialized = false;
  private defaultFrom: string;

  constructor() {
    this.initialize();
    this.defaultFrom = process.env.FROM_EMAIL || 'noreply@foundavibe.com';
  }

  private initialize(): void {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY environment variable is required');
    }

    sgMail.setApiKey(apiKey);
    this.initialized = true;
    console.log('SendGrid email service initialized');
  }

  async sendEmail(message: EmailMessage): Promise<EmailResponse> {
    if (!this.initialized) {
      throw new ApiError(500, 'Email Service Error', 'Email service not initialized');
    }

    try {
      const emailMessage: sgMail.MailDataRequired = {
        to: message.to,
        from: message.from || this.defaultFrom,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.templateId && {
          templateId: message.templateId,
          dynamicTemplateData: message.dynamicTemplateData
        })
      };

      const [response] = await sgMail.send(emailMessage);
      
      console.log(`Email sent successfully to ${message.to}:`, response.statusCode);
      
      return {
        messageId: response.headers['x-message-id'] as string,
        statusCode: response.statusCode
      };
    } catch (error) {
      console.error('Error sending email:', error);
      throw new ApiError(500, 'Email Service Error', 'Failed to send email');
    }
  }

  async sendOTPEmail(email: string, otp: string, recipientName?: string): Promise<EmailResponse> {
    const templatePath = join(__dirname, '../templates/otp-email.html');
    let htmlTemplate: string;

    try {
      htmlTemplate = readFileSync(templatePath, 'utf8');
    } catch (error) {
      // Fallback to simple HTML template if file doesn't exist
      htmlTemplate = this.getDefaultOTPTemplate();
    }

    const html = htmlTemplate
      .replace('{{recipientName}}', recipientName || 'User')
      .replace('{{otp}}', otp)
      .replace('{{expiryMinutes}}', '5');

    const message: EmailMessage = {
      to: email,
      from: this.defaultFrom,
      subject: 'Your One-Time Password - FoundAVibe',
      text: `Your one-time password is: ${otp}. This code will expire in 5 minutes.`,
      html
    };

    return this.sendEmail(message);
  }

  async sendWelcomeEmail(email: string, name: string): Promise<EmailResponse> {
    const message: EmailMessage = {
      to: email,
      from: this.defaultFrom,
      subject: 'Welcome to FoundAVibe!',
      text: `Welcome ${name}! Thank you for joining FoundAVibe.`,
      html: `
        <h1>Welcome ${name}!</h1>
        <p>Thank you for joining FoundAVibe. We're excited to have you on board!</p>
        <p>Start exploring events in your area and connect with your community.</p>
      `
    };

    return this.sendEmail(message);
  }

  private getDefaultOTPTemplate(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Your One-Time Password</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #007bff; text-align: center; padding: 20px; background: #f8f9fa; border-radius: 5px; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Hello {{recipientName}},</h2>
          <p>Your one-time password for FoundAVibe is:</p>
          <div class="otp-code">{{otp}}</div>
          <p>This code will expire in {{expiryMinutes}} minutes. Please don't share this code with anyone.</p>
          <div class="footer">
            <p>If you didn't request this code, please ignore this email.</p>
            <p>&copy; 2024 FoundAVibe. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export const emailService = new EmailService();
export default emailService;