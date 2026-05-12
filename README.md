# Mate App

A Node.js application using Express, MySQL, and Anthropic AI SDK.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Set up environment variables in `.env` file (copy from `.env.example`).

3. Run database migrations:
   ```
   npm run migrate:schema
   npm run migrate:admins
   npm run migrate:departments
   npm run migrate:preferences
   ```

4. Seed data:
   ```
   npm run seed:master
   npm run seed:sample-users
   ```

## Running the Project

- Development mode: `npm run dev`
- Production: `npm start`
- Test database: `npm run test:db`

## Features

- User authentication
- Chat functionality
- Preferences management
- Admin panel

## Technologies

- Node.js
- Express
- MySQL
- Anthropic AI SDK