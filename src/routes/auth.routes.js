const express = require('express');
const { z } = require('zod');
const authService = require('../services/auth.service');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

const registerSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address')
    .max(255, 'Email must be less than 255 characters')
    .transform(v => v.trim().toLowerCase()),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be less than 128 characters')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[@$!%*?&]/, 'Password must contain at least one special character (@$!%*?&)'),
  name: z.string().max(100, 'Name must be less than 100 characters').trim().optional(),
});

const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .transform(v => v.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const result = await authService.register(req.body.email, req.body.password, req.body.name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const result = await authService.login(req.body.email, req.body.password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
