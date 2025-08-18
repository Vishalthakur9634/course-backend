const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: './config/config.env' });

// Import routes
const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videoRoutes');

const app = express();

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// COMPREHENSIVE REQUEST LOGGING
app.use((req, res, next) => {
  console.log('\n=== INCOMING REQUEST ===');
  console.log(`${req.method} ${req.url}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('All headers:', JSON.stringify(req.headers, null, 2));
  console.log('========================\n');
  next();
});

// Configure allowed origins
const allowedOrigins = [
  'https://course-fronten.netlify.app',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

console.log('🔧 Server starting with allowed origins:', allowedOrigins);

// CORS CONFIGURATION WITH EXTENSIVE LOGGING
app.use(cors({
  origin: function (origin, callback) {
    console.log('\n🔍 CORS CHECK:');
    console.log('Request origin:', origin);
    console.log('Allowed origins:', allowedOrigins);
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ No origin - ALLOWED');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      console.log('✅ Origin ALLOWED:', origin);
      callback(null, true);
    } else {
      console.log('❌ Origin BLOCKED:', origin);
      console.log('Available origins:', allowedOrigins);
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Content-Length', 'Content-Range'],
  optionsSuccessStatus: 200
}));

// RESPONSE LOGGING
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    console.log('\n=== OUTGOING RESPONSE ===');
    console.log(`Status: ${res.statusCode}`);
    console.log('Headers:', JSON.stringify(res.getHeaders(), null, 2));
    console.log('========================\n');
    originalSend.call(this, data);
  };
  next();
});

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// MANUAL TEST ROUTE TO VERIFY CORS
app.all('/api/test', (req, res) => {
  console.log('🧪 Test route hit!');
  res.json({
    success: true,
    message: `${req.method} request successful`,
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
    cors_headers: {
      'access-control-allow-origin': res.get('Access-Control-Allow-Origin'),
      'access-control-allow-credentials': res.get('Access-Control-Allow-Credentials')
    }
  });
});

// SIMPLE AUTH TEST ROUTE (to isolate the issue)
app.post('/api/auth/test-register', (req, res) => {
  console.log('🧪 Auth test route hit!');
  res.json({
    success: true,
    message: 'Test register endpoint working',
    origin: req.headers.origin,
    body: req.body
  });
});

// Routes
app.use('/api/auth', (req, res, next) => {
  console.log('🔐 Auth route middleware hit:', req.method, req.url);
  next();
}, authRoutes);

app.use('/api/videos', videoRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    cors: {
      allowedOrigins: allowedOrigins,
      yourOrigin: req.headers.origin,
      isAllowed: allowedOrigins.includes(req.headers.origin)
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Catch-all for debugging missing routes
app.use('/api/*', (req, res) => {
  console.log('🚫 Unmatched API route:', req.method, req.url);
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.url}`,
    availableRoutes: [
      'GET /api/health',
      'ALL /api/test',
      'POST /api/auth/test-register',
      'POST /api/auth/register (from authRoutes)'
    ]
  });
});

// Global error handler with enhanced logging
app.use((err, req, res, next) => {
  console.error('\n❌ ERROR HANDLER TRIGGERED:');
  console.error('Error message:', err.message);
  console.error('Error stack:', err.stack);
  console.error('Request URL:', req.url);
  console.error('Request method:', req.method);
  console.error('Request origin:', req.headers.origin);
  
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    url: req.url,
    method: req.method
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`🔍 404: ${req.method} ${req.url} from ${req.headers.origin}`);
  
  res.status(404).json({
    success: false,
    error: `Endpoint not found: ${req.method} ${req.url}`
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('\n🚀 SERVER STARTED');
  console.log(`Port: ${PORT}`);
  console.log('Allowed origins:', allowedOrigins);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('\n📋 Test these endpoints:');
  console.log(`- GET  https://course-backends.onrender.com/api/health`);
  console.log(`- POST https://course-backends.onrender.com/api/test`);
  console.log(`- POST https://course-backends.onrender.com/api/auth/test-register`);
  console.log('========================\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});