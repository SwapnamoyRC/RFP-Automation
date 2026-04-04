const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../config/logger');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it in your .env file.');
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

class AuthService {
  async register(email, password, name) {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new Error('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, role, created_at`,
      [email, passwordHash, name || null]
    );

    const user = result.rows[0];
    const token = this._generateToken(user);
    logger.info(`[auth] User registered: ${email}`);

    return { user, token };
  }

  async login(email, password) {
    const result = await pool.query(
      'SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new Error('Invalid email or password');
    }

    const { password_hash, ...safeUser } = user;
    const token = this._generateToken(safeUser);
    logger.info(`[auth] User logged in: ${email}`);

    return { user: safeUser, token };
  }

  verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }

  _generateToken(user) {
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }
}

module.exports = new AuthService();
