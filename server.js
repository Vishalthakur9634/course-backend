const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config({ path: './config/config.env' });

const app = express();

// Server state tracking
let isServerReady = false;
let isShuttingDown = false;

// Enhanced but simple error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err.message);
  console.error('Stack:', err.stack);
  
  if (!isShuttingDown) {
    isShuttingDown = true;
    process.exit(1);
  }
});

// Database connection with retry logic (simplified from working version)
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const connectDB = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }
    
    // Use the same simple connection options that worked in the first version
    const conn = await mongoose.connect(process.env.MONGO_URI);
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name || 'default'}`);
    
    // Reset reconnect attempts on success
    reconnectAttempts = 0;
    
    // Simple event listeners (only set once)
    if (!mongoose.connection.listeners('error').length) {
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB error:', err.message);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.log('⚠️ MongoDB disconnected');
        if (!isShuttingDown && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          setTimeout(connectDB, 5000);
        }
      });
    }
    
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    
    if (err.name === 'MongooseServerSelectionError') {
      console.error('🔍 Check: MongoDB Atlas cluster status, IP whitelist, credentials');
    }
    
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('💥 Max reconnection attempts reached. Exiting...');
      process.exit(1);
    }
    
    const delay = Math.min(reconnectAttempts * 2000, 10000);
    console.log(`🔄 Retrying in ${delay/1000}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(connectDB, delay);
  }
};

// Connect to database
connectDB();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Configure allowed origins (from working version)
const allowedOrigins = [
  'https://course-fronten.netlify.app',
  'https://course-fronte.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

console.log('🔧 Allowed origins:', allowedOrigins);

// COMPREHENSIVE REQUEST LOGGING (from working version)
app.use((req, res, next) => {
  console.log('\n=== INCOMING REQUEST ===');
  console.log(`${req.method} ${req.url}`);
  console.log('Origin:', req.headers.origin);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('========================\n');
  next();
});

// Enhanced CORS configuration (from working version with improvements)
const corsOptions = {
  origin: function (origin, callback) {
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
      // In development, allow all origins but warn
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ Development mode: allowing blocked origin');
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
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

// Apply CORS middleware
app.use(cors(corsOptions));

// VIDEO-SPECIFIC CORS MIDDLEWARE (from working version)
app.use('/api/videos', cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      if (process.env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
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
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-Modified-Since',
    'If-None-Match',
    'If-Range',
    'Range',
    'Accept-Ranges',
    'Content-Range',
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

// Custom middleware for video streaming endpoints (from working version)
app.use('/api/videos/stream', (req, res, next) => {
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
  
  if (req.method === 'OPTIONS') {
    console.log('🎥 Handling OPTIONS request for video streaming');
    return res.status(200).end();
  }
  
  next();
});

// Basic logging middleware
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// SERVE UPLOADED FILES WITH PROPER HEADERS (from working version)
app.use('/uploads', (req, res, next) => {
  console.log('📁 Serving file from uploads:', req.path);
  
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

// Handle all OPTIONS requests globally (from working version)
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

// Basic route for testing
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Course Backend API is running successfully',
    status: 'healthy',
    cors: 'Enhanced CORS configuration active',
    uploads: 'Uploads directory available at /uploads',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting...'
  });
});

// Health check endpoint with comprehensive info
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  res.json({
    success: true,
    message: 'Server is healthy',
    cors: {
      allowedOrigins: allowedOrigins,
      yourOrigin: req.headers.origin,
      isAllowed: !req.headers.origin || allowedOrigins.includes(req.headers.origin)
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus === 1 ? 'Connected' : 'Connecting',
      readyState: dbStatus
    },
    uploads: {
      directory: uploadDir,
      accessible: fs.existsSync(uploadDir)
    }
  });
});

// MANUAL TEST ROUTES (from working version)
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

app.post('/api/auth/test-register', (req, res) => {
  console.log('🧪 Auth test route hit!');
  res.json({
    success: true,
    message: 'Test register endpoint working',
    origin: req.headers.origin,
    body: req.body
  });
});

// Debug route for troubleshooting
app.get('/api/debug', (req, res) => {
  res.json({
    success: true,
    server: {
      ready: isServerReady,
      uptime: process.uptime(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'Connected' : 'Not Connected',
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name
    },
    uploads: {
      directory: uploadDir,
      exists: fs.existsSync(uploadDir)
    },
    request: {
      method: req.method,
      url: req.url,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    }
  });
});

// Import routes with fallback handling
let authRoutes, videoRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading auth routes:', error.message);
  authRoutes = express.Router();
  authRoutes.all('*', (req, res) => {
    res.status(503).json({
      success: false,
      error: 'Auth service temporarily unavailable',
      details: error.message
    });
  });
}

try {
  videoRoutes = require('./routes/videoRoutes');
  console.log('✅ Video routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading video routes:', error.message);
  videoRoutes = express.Router();
  videoRoutes.all('*', (req, res) => {
    res.status(503).json({
      success: false,
      error: 'Video service temporarily unavailable',
      details: error.message
    });
  });
}

// Apply routes with logging
app.use('/api/auth', (req, res, next) => {
  console.log('🔐 Auth route middleware hit:', req.method, req.url);
  next();
}, authRoutes);

app.use('/api/videos', (req, res, next) => {
  console.log('🎥 Video route middleware hit:', req.method, req.url);
  next();
}, videoRoutes);

// Catch-all for debugging missing API routes
app.use('/api/*', (req, res) => {
  console.log('🚫 Unmatched API route:', req.method, req.url);
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.url}`,
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'GET /api/debug',
      'ALL /api/test',
      'POST /api/auth/test-register',
      'POST /api/auth/* (from authRoutes)',
      'ALL /api/videos/* (from videoRoutes)',
      'GET /uploads/* (static files)'
    ]
  });
});

// Enhanced error handler with CORS support (simplified)
app.use((err, req, res, next) => {
  console.error('\n❌ ERROR HANDLER:');
  console.error('Message:', err.message);
  console.error('URL:', req.url);
  console.error('Method:', req.method);

  // Ensure CORS headers are set even for errors
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle specific error types
  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err.name === 'CastError') {
    statusCode = 404;
    message = 'Resource not found';
  } else if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate field value entered';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  } else if (err.message.includes('CORS')) {
    statusCode = 403;
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    url: req.url,
    method: req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle unhandled routes
app.all('*', (req, res) => {
  console.log(`🔍 404: ${req.method} ${req.url} from ${req.headers.origin}`);
  
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

// Server configuration
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  isServerReady = true;
  console.log('\n🚀 ================================');
  console.log('🚀 SERVER STARTED SUCCESSFULLY');
  console.log('🚀 ================================');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🔗 Allowed origins:', allowedOrigins);
  console.log(`📁 Uploads directory: ${uploadDir}`);
  console.log('\n📋 Test these endpoints:');
  console.log(`- GET  http://localhost:${PORT}/api/health`);
  console.log(`- GET  http://localhost:${PORT}/api/test`);
  console.log(`- POST http://localhost:${PORT}/api/auth/test-register`);
  console.log(`- GET  http://localhost:${PORT}/api/debug`);
  console.log('========================\n');
});

// Handle unhandled promise rejections (simplified)
process.on('unhandledRejection', (err, promise) => {
  console.log(`❌ Unhandled Rejection: ${err.message}`);
  if (!isShuttingDown) {
    server.close(() => process.exit(1));
  }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n📴 ${signal} received. Shutting down gracefully...`);
  isShuttingDown = true;
  
  server.close(() => {
    console.log('📴 HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('📴 MongoDB connection closed');
      process.exit(0);
    });
  });
  
  setTimeout(() => {
    console.error('📴 Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export the Express app
module.exports = app;