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
  'https://course-fronte.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

console.log('🔧 Server starting with allowed origins:', allowedOrigins);

// Enhanced CORS configuration for different endpoints
const generalCorsOptions = {
  origin: function (origin, callback) {
    console.log('\n🔍 GENERAL CORS CHECK:');
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'Content-Language',
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'Range',
    'User-Agent',
    'Origin'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Content-Type',
    'Cache-Control',
    'Last-Modified',
    'ETag',
    'X-Content-Duration'
  ],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours preflight cache
};

// Apply general CORS middleware first
app.use(cors(generalCorsOptions));

// VIDEO-SPECIFIC CORS MIDDLEWARE (for streaming and video endpoints)
app.use('/api/videos', cors({
  origin: function (origin, callback) {
    console.log('\n🎥 VIDEO CORS CHECK:');
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'Content-Language',
    'Origin',
    'Cache-Control', // Added for video streaming
    'Pragma',        // Added for caching
    'Expires',       // Added for caching
    'If-Modified-Since', // Added for conditional requests
    'If-None-Match',     // Added for conditional requests
    'If-Range',      // Added for range requests
    'Range',         // Added for partial content requests (video seeking)
    'Accept-Ranges', // Added for range requests
    'Content-Range', // Added for partial content responses
    'User-Agent'
  ],
  exposedHeaders: [
    'Content-Length', 
    'Content-Range',
    'Accept-Ranges',
    'Cache-Control',
    'Expires',
    'Last-Modified',
    'ETag',
    'X-Content-Duration'
  ],
  optionsSuccessStatus: 200,
  maxAge: 86400
}));

// Custom middleware to handle CORS for video streaming endpoints specifically
app.use('/api/videos/stream', (req, res, next) => {
  // Set CORS headers explicitly for video streaming
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'Content-Language',
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'Range',
    'User-Agent',
    'Origin'
  ].join(', '));
  
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Content-Type',
    'Cache-Control',
    'Last-Modified',
    'ETag',
    'X-Content-Duration'
  ].join(', '));
  
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('🎥 Handling OPTIONS request for video streaming');
    return res.status(200).end();
  }
  
  next();
});

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

// SERVE UPLOADED FILES WITH PROPER HEADERS FOR VIDEO STREAMING
app.use('/uploads', (req, res, next) => {
  console.log('📁 Serving file from uploads:', req.path);
  
  // Set CORS headers for uploads
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Set appropriate headers for video files
  if (req.path.endsWith('.mp4') || req.path.endsWith('.m3u8') || req.path.endsWith('.ts')) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', req.path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 
                  req.path.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    console.log('🎬 Setting video headers for:', req.path);
  }
  
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Handle all OPTIONS requests globally
app.options('*', (req, res) => {
  console.log('🔧 Handling global OPTIONS request for:', req.path);
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.setHeader('Access-Control-Allow-Headers', [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'Range',
    'User-Agent'
  ].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(200).end();
});

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

// Basic route for testing
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API is running successfully',
    cors: 'Enhanced CORS configuration active',
    uploads: 'Uploads directory available at /uploads'
  });
});

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
    environment: process.env.NODE_ENV || 'development',
    uploads: {
      directory: path.join(__dirname, 'uploads'),
      accessible: true
    }
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
      'POST /api/auth/register (from authRoutes)',
      'GET /uploads/* (static files)'
    ]
  });
});

// Enhanced error handler with CORS support
app.use((err, req, res, next) => {
  console.error('\n❌ ERROR HANDLER TRIGGERED:');
  console.error('Error message:', err.message);
  console.error('Error stack:', err.stack);
  console.error('Request URL:', req.url);
  console.error('Request method:', req.method);
  console.error('Request origin:', req.headers.origin);

  // Ensure CORS headers are set even for errors
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Mongoose errors
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    err = { message, statusCode: 404 };
  } else if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    err = { message, statusCode: 400 };
  } else if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    err = { message, statusCode: 400 };
  }
  
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    url: req.url,
    method: req.method
  });
});

// Handle unhandled routes
app.all('*', (req, res) => {
  console.log(`🔍 404: ${req.method} ${req.url} from ${req.headers.origin}`);
  
  // Ensure CORS headers for 404s
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
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
  console.log('Uploads directory:', path.join(__dirname, 'uploads'));
  console.log('\n📋 Test these endpoints:');
  console.log(`- GET  https://course-backends.onrender.com/api/health`);
  console.log(`- POST https://course-backends.onrender.com/api/test`);
  console.log(`- POST https://course-backends.onrender.com/api/auth/test-register`);
  console.log(`- GET  https://course-backends.onrender.com/uploads/[filename]`);
  console.log('========================\n');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
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

// Export the Express app for deployment platforms
module.exports = app;
