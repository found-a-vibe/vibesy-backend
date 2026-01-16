/**
 * Validates required environment variables on startup
 * Throws an error if any required variables are missing or invalid
 */
export const validateEnv = (): void => {
  const errors: string[] = [];

  // Required environment variables
  const required: Record<string, string> = {
    // Server
    'SERVER_PORT': 'Server port number',
    'NODE_ENV': 'Node environment (development, production, test)',
    
    // Database
    'PG_HOST': 'PostgreSQL host',
    'PG_PORT': 'PostgreSQL port',
    'PG_DATABASE': 'PostgreSQL database name',
    'PG_USER': 'PostgreSQL username',
    'PG_PASSWORD': 'PostgreSQL password',
    
    // Redis
    'REDIS_URL': 'Redis connection URL',
    
    // Stripe
    'STRIPE_SECRET_KEY': 'Stripe secret key',
    'STRIPE_PUBLISHABLE_KEY': 'Stripe publishable key',
    'STRIPE_WEBHOOK_SECRET': 'Stripe webhook secret',
    
    // Firebase (uses GOOGLE_APPLICATION_CREDENTIALS, not FIREBASE_SERVICE_ACCOUNT_PATH)
    'GOOGLE_APPLICATION_CREDENTIALS': 'Firebase service account JSON path',
    
    // SendGrid
    'SENDGRID_API_KEY': 'SendGrid API key for email delivery',
    
    // Application
    'APP_URL': 'Application URL',
    'RETURN_URL_SCHEME': 'Stripe Connect return URL',
    'REFRESH_URL': 'Stripe Connect refresh URL',
  };

  // Check for missing required variables
  for (const [key, description] of Object.entries(required)) {
    if (!process.env[key] || process.env[key]!.trim() === '') {
      errors.push(`Missing required environment variable: ${key} (${description})`);
    }
  }
  
  // Special check: Accept either FROM_EMAIL or SENDGRID_FROM_EMAIL
  if ((!process.env.FROM_EMAIL || process.env.FROM_EMAIL.trim() === '') && 
      (!process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL.trim() === '')) {
    errors.push('Missing required environment variable: FROM_EMAIL or SENDGRID_FROM_EMAIL (SendGrid from email address)');
  }

  // Validate formats
  // Skip PG_HOST validation - cloud providers use various formats
  
  if (process.env.PG_PORT && !isValidPort(process.env.PG_PORT)) {
    errors.push('PG_PORT must be a valid port number (1-65535)');
  }

  if (process.env.SERVER_PORT && !isValidPort(process.env.SERVER_PORT)) {
    errors.push('SERVER_PORT must be a valid port number (1-65535)');
  }

  if (process.env.REDIS_URL && !isValidRedisUrl(process.env.REDIS_URL)) {
    errors.push('REDIS_URL must be a valid Redis connection string (redis://...)');
  }

  if (process.env.STRIPE_SECRET_KEY && !isValidStripeKey(process.env.STRIPE_SECRET_KEY, 'secret')) {
    errors.push('STRIPE_SECRET_KEY must be a valid Stripe secret key (starts with sk_)');
  }

  if (process.env.STRIPE_PUBLISHABLE_KEY && !isValidStripeKey(process.env.STRIPE_PUBLISHABLE_KEY, 'publishable')) {
    errors.push('STRIPE_PUBLISHABLE_KEY must be a valid Stripe publishable key (starts with pk_)');
  }

  if (process.env.STRIPE_WEBHOOK_SECRET && !isValidStripeWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET)) {
    errors.push('STRIPE_WEBHOOK_SECRET must be a valid Stripe webhook secret (starts with whsec_)');
  }

  if (process.env.SENDGRID_FROM_EMAIL && !isValidEmail(process.env.SENDGRID_FROM_EMAIL)) {
    errors.push('SENDGRID_FROM_EMAIL must be a valid email address');
  }

  if (process.env.APP_URL && !isValidUrl(process.env.APP_URL)) {
    errors.push('APP_URL must be a valid URL');
  }

  if (process.env.RETURN_URL_SCHEME && !isValidUrl(process.env.RETURN_URL_SCHEME)) {
    errors.push('RETURN_URL_SCHEME must be a valid URL');
  }

  if (process.env.REFRESH_URL && !isValidUrl(process.env.REFRESH_URL)) {
    errors.push('REFRESH_URL must be a valid URL');
  }

  if (process.env.NODE_ENV && !['development', 'production', 'test'].includes(process.env.NODE_ENV)) {
    errors.push('NODE_ENV must be one of: development, production, test');
  }

  // Optional but recommended
  const warnings: string[] = [];

  if (!process.env.PLATFORM_FEE_BASIS_POINTS) {
    warnings.push('PLATFORM_FEE_BASIS_POINTS not set, using default: 300 (3%)');
  } else {
    const fee = parseInt(process.env.PLATFORM_FEE_BASIS_POINTS);
    if (isNaN(fee) || fee < 0 || fee > 10000) {
      errors.push('PLATFORM_FEE_BASIS_POINTS must be a number between 0 and 10000 (0-100%)');
    }
  }

  if (!process.env.SENDGRID_FROM_NAME) {
    warnings.push('SENDGRID_FROM_NAME not set, emails will have no from name');
  }

  if (!process.env.FIREBASE_STORAGE_BUCKET) {
    warnings.push('FIREBASE_STORAGE_BUCKET not set, file uploads may not work');
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    if (process.env.APP_URL?.includes('localhost')) {
      errors.push('APP_URL cannot contain localhost in production');
    }

    if (!process.env.APP_URL?.startsWith('https://')) {
      errors.push('APP_URL must use HTTPS in production');
    }

    if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      warnings.push('⚠️  WARNING: Using Stripe TEST keys in production!');
    }
  }

  // Throw error if any validation failed
  if (errors.length > 0) {
    console.error('❌ Environment variable validation failed:\n');
    errors.forEach(error => console.error(`  - ${error}`));
    console.error('\nPlease check your .env file and ensure all required variables are set correctly.\n');
    throw new Error('Environment variable validation failed');
  }

  // Display warnings
  if (warnings.length > 0) {
    console.warn('⚠️  Environment variable warnings:\n');
    warnings.forEach(warning => console.warn(`  - ${warning}`));
    console.warn('');
  }

  console.log('✅ Environment variables validated successfully');
};

// Validation helper functions
function isValidHostname(hostname: string): boolean {
  // Allow localhost, IP addresses, domain names, and cloud provider hostnames
  // Very permissive to support various cloud provider formats (AWS RDS, GCP, Azure, Render, etc.)
  // Must contain only alphanumeric, hyphens, dots, and underscores
  // Cannot start or end with hyphen or dot
  if (!hostname || hostname.length === 0) return false;
  if (hostname.startsWith('-') || hostname.startsWith('.') || hostname.endsWith('.')) return false;
  
  // Allow alphanumeric, hyphens, dots, underscores
  const validChars = /^[a-zA-Z0-9.-]+$/;
  return validChars.test(hostname);
}

function isValidPort(port: string): boolean {
  const portNum = parseInt(port);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

function isValidRedisUrl(url: string): boolean {
  return url.startsWith('redis://') || url.startsWith('rediss://');
}

function isValidStripeKey(key: string, type: 'secret' | 'publishable'): boolean {
  const prefix = type === 'secret' ? 'sk_' : 'pk_';
  return key.startsWith(prefix);
}

function isValidStripeWebhookSecret(secret: string): boolean {
  return secret.startsWith('whsec_');
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get environment variable with type safety and optional default
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is not set and no default provided`);
  }
  return value || defaultValue!;
}

/**
 * Get environment variable as number
 */
export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (!value) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is not set and no default provided`);
    }
    return defaultValue;
  }
  const parsed = parseInt(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

/**
 * Get environment variable as boolean
 */
export function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is not set and no default provided`);
    }
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}
