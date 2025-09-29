import { readFile } from 'fs/promises';
import { join } from 'path';
import { ApiError } from './errors';

interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
}

interface TemplateData {
  [key: string]: string | number | boolean | Date;
}

class TemplateManager {
  private cache = new Map<string, string>();
  private readonly templatesDir: string;

  constructor() {
    this.templatesDir = join(__dirname, '../templates');
  }

  /**
   * Load a template from file with caching
   */
  async loadTemplate(templateName: string): Promise<string> {
    const cacheKey = templateName;
    
    // Return cached template if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const templatePath = join(this.templatesDir, `${templateName}.html`);
      const template = await readFile(templatePath, 'utf-8');
      
      // Cache the template
      this.cache.set(cacheKey, template);
      
      return template;
    } catch (error) {
      console.error(`Failed to load template ${templateName}:`, error);
      throw new ApiError(500, 'Template Error', `Failed to load template: ${templateName}`);
    }
  }

  /**
   * Replace placeholders in template with data
   */
  renderTemplate(template: string, data: TemplateData): string {
    let rendered = template;

    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      const stringValue = this.formatValue(value);
      
      // Replace all occurrences of the placeholder
      rendered = rendered.split(placeholder).join(stringValue);
    }

    // Remove any remaining unreplaced placeholders
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

    return rendered;
  }

  /**
   * Load and render a template with data
   */
  async render(templateName: string, data: TemplateData): Promise<string> {
    const template = await this.loadTemplate(templateName);
    return this.renderTemplate(template, data);
  }

  /**
   * Generate OTP email message
   */
  async generateOTPEmail(
    email: string, 
    otp: string, 
    recipientName?: string,
    expiryMinutes: number = 5
  ): Promise<EmailMessage> {
    const data: TemplateData = {
      recipientName: recipientName || 'User',
      otp,
      expiryMinutes,
      appName: 'FoundAVibe',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@foundavibe.com',
      year: new Date().getFullYear()
    };

    try {
      const html = await this.render('otp-email', data);
      
      return {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
        subject: 'Your One-Time Password - FoundAVibe',
        html,
        text: `Your OTP for FoundAVibe is: ${otp}. This code expires in ${expiryMinutes} minutes.`
      };
    } catch (error) {
      // Fallback to simple template if file template fails
      console.warn('Using fallback OTP template:', error);
      return this.generateFallbackOTPEmail(email, otp, recipientName, expiryMinutes);
    }
  }

  /**
   * Generate welcome email message
   */
  async generateWelcomeEmail(
    email: string, 
    name: string,
    metadata?: TemplateData
  ): Promise<EmailMessage> {
    const data: TemplateData = {
      name,
      email,
      appName: 'FoundAVibe',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@foundavibe.com',
      appUrl: process.env.APP_URL || 'https://foundavibe.com',
      year: new Date().getFullYear(),
      ...metadata
    };

    try {
      const html = await this.render('welcome-email', data);
      
      return {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
        subject: 'Welcome to FoundAVibe!',
        html,
        text: `Welcome to FoundAVibe, ${name}! We're excited to have you join our community.`
      };
    } catch (error) {
      // Fallback to simple template
      console.warn('Using fallback welcome template:', error);
      return this.generateFallbackWelcomeEmail(email, name);
    }
  }

  /**
   * Generate password reset email message
   */
  async generatePasswordResetEmail(
    email: string, 
    resetToken: string, 
    name?: string,
    expiryHours: number = 24
  ): Promise<EmailMessage> {
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
    
    const data: TemplateData = {
      name: name || 'User',
      resetUrl,
      resetToken,
      expiryHours,
      appName: 'FoundAVibe',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@foundavibe.com',
      year: new Date().getFullYear()
    };

    try {
      const html = await this.render('password-reset-email', data);
      
      return {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
        subject: 'Password Reset - FoundAVibe',
        html,
        text: `Reset your FoundAVibe password by clicking this link: ${resetUrl}. This link expires in ${expiryHours} hours.`
      };
    } catch (error) {
      // Fallback to simple template
      console.warn('Using fallback password reset template:', error);
      return this.generateFallbackPasswordResetEmail(email, resetUrl, name, expiryHours);
    }
  }

  /**
   * Clear template cache
   */
  clearCache(templateName?: string): void {
    if (templateName) {
      this.cache.delete(templateName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; templates: string[] } {
    return {
      size: this.cache.size,
      templates: Array.from(this.cache.keys())
    };
  }

  private formatValue(value: string | number | boolean | Date): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    return String(value);
  }

  private generateFallbackOTPEmail(
    email: string, 
    otp: string, 
    recipientName?: string,
    expiryMinutes: number = 5
  ): EmailMessage {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Your One-Time Password</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .otp { font-size: 28px; font-weight: bold; color: #007bff; text-align: center; padding: 20px; background: #f8f9fa; border-radius: 5px; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>FoundAVibe</h1>
          </div>
          <div class="content">
            <h2>Hello ${recipientName || 'User'},</h2>
            <p>Your one-time password for FoundAVibe is:</p>
            <div class="otp">${otp}</div>
            <p>This code will expire in ${expiryMinutes} minutes. Please don't share this code with anyone.</p>
            <p>If you didn't request this code, please ignore this email or contact our support team.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} FoundAVibe. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
      subject: 'Your One-Time Password - FoundAVibe',
      html,
      text: `Your OTP for FoundAVibe is: ${otp}. This code expires in ${expiryMinutes} minutes.`
    };
  }

  private generateFallbackWelcomeEmail(email: string, name: string): EmailMessage {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Welcome to FoundAVibe</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .cta { background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to FoundAVibe!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Thank you for joining FoundAVibe! We're excited to have you as part of our community.</p>
            <p>Start exploring events in your area and connecting with like-minded people.</p>
            <a href="${process.env.APP_URL || 'https://foundavibe.com'}" class="cta">Get Started</a>
            <p>If you have any questions, don't hesitate to reach out to our support team.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} FoundAVibe. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
      subject: 'Welcome to FoundAVibe!',
      html,
      text: `Welcome to FoundAVibe, ${name}! We're excited to have you join our community.`
    };
  }

  private generateFallbackPasswordResetEmail(
    email: string, 
    resetUrl: string, 
    name?: string,
    expiryHours: number = 24
  ): EmailMessage {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Password Reset</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .button { background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset</h1>
          </div>
          <div class="content">
            <h2>Hello ${name || 'User'},</h2>
            <p>We received a request to reset your password for your FoundAVibe account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p>This link will expire in ${expiryHours} hours.</p>
            <p>If you didn't request this password reset, please ignore this email or contact our support team.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} FoundAVibe. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@foundavibe.com',
      subject: 'Password Reset - FoundAVibe',
      html,
      text: `Reset your FoundAVibe password by clicking this link: ${resetUrl}. This link expires in ${expiryHours} hours.`
    };
  }
}

// Create singleton instance
export const templateManager = new TemplateManager();

// Legacy compatibility function
export const generateMessage = async (email: string, otp: string): Promise<EmailMessage> => {
  return templateManager.generateOTPEmail(email, otp);
};

export default templateManager;