# One-Time Password Service

This is an OTP (One-Time Password) service built using Express.js. The service provides two main routes: `send` and `verify`, allowing users to send OTPs via email and verify them for authentication purposes. It uses the following technologies:

- **SendGrid**: For sending OTPs via email.
- **Firebase Admin SDK**: For secure user management.
- **Redis**: For temporary storage and expiration of OTPs.

## Table of Contents
1. [Installation](#installation)
2. [Environment Variables](#environment-variables)
3. [Usage](#usage)
4. [Routes](#routes)
5. [Technologies Used](#technologies-used)
6. [Contributing](#contributing)
7. [License](#license)

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/one-time-password-service.git
   cd one-time-password-service
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables** (create a `.env` file in the root directory):
   ```
   PORT=3000
   SENDGRID_API_KEY=your-sendgrid-api-key
   FIREBASE_ADMIN_SDK_PATH=path-to-your-firebase-admin-sdk-file.json
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

## Environment Variables

The application requires the following environment variables:

- `PORT`: The port the server will run on.
- `SENDGRID_API_KEY`: API key for SendGrid to send emails.
- `FIREBASE_ADMIN_SDK_PATH`: Path to the Firebase Admin SDK credentials file.
- `REDIS_HOST`: Redis host (default: `localhost`).
- `REDIS_PORT`: Redis port (default: `6379`).

## Usage

Once the server is up and running, you can interact with the OTP service using the following routes:

### 1. `/send`

- **Method**: `POST`
- **Description**: Sends an OTP to the specified email.
- **Request Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response**:
  ```json
  {
    "message": "OTP sent successfully."
  }
  ```

### 2. `/verify`

- **Method**: `POST`
- **Description**: Verifies the provided OTP for the specified email.
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "otp": "1234"
  }
  ```
- **Response**:
  ```json
  {
    "message": "OTP verified successfully."
  }
  ```
  If the OTP is invalid or expired, an error message will be returned.

## Technologies Used

- **Express.js**: For building the REST API.
- **SendGrid**: For sending OTPs via email.
- **Firebase Admin SDK**: For user management and security.
- **Redis**: For storing and managing OTP expiration.

## Contributing

Contributions are welcome! If you have suggestions or improvements, feel free to create a pull request or open an issue.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.