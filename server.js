const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables first
dotenv.config({ path: './config/config.env' });

const app = express();

// Enhanced error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down...');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Stack trace:', err.stack);
  process.exit(1);
});

// Enhanced error handling for unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED REJECTION! Shutting down...');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  if (err.stack) console.error('Stack trace:', err.stack);
  
  if (server) {
    server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// Database connection with retry logic
const connectDB = async () => {
  try {
    console.log('🔄 Attempting to connect to MongoDB...');
    console.log('MongoDB URI:', process.env.MONGO_URI ? 'Set (hidden for security)' : 'NOT SET');
    
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000, // 45 seconds
      family: 4 // Use IPv4, skip trying IPv6
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database Name: ${conn.connection.name}`);
    
    return conn;
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    console.error('Full error:', err);
    
    // Retry connection after 5 seconds
    console.log('🔄 Retrying database connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

// Initialize database connection
connectDB();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
const fs = require('fs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadDir);
}

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

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
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
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Additional CORS middleware for video routes
app.use('/api/videos', cors(corsOptions));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (path.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Course Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is healthy',
    cors: {
      allowedOrigins: allowedOrigins,
      yourOrigin: req.headers.origin,
      isAllowed: allowedOrigins.includes(req.headers.origin)
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Import routes with error handling
let authRoutes, videoRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading auth routes:', error.message);
  // Create a dummy router to prevent crashes
  authRoutes = express.Router();
  authRoutes.all('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Auth routes not available'
    });
  });
}

try {
  videoRoutes = require('./routes/videoRoutes');
  console.log('✅ Video routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading video routes:', error.message);
  // Create a dummy router to prevent crashes
  videoRoutes = express.Router();
  videoRoutes.all('*', (req, res) => {
    res.status(500).json({
      success: false,
      error: 'Video routes not available'
    });
  });
}

// Apply routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);

// Test route
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API test endpoint working',
    timestamp: new Date().toISOString(),
    headers: req.headers
  });
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
  console.log(`🚫 API route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/health',
      'GET /api/test',
      'POST /api/auth/*',
      'POST /api/videos/*'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Global error handler triggered:');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Request URL:', req.url);
  console.error('Request method:', req.method);
  
  // Don't send stack trace in production
  const errorResponse = {
    success: false,
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(err.statusCode || 500).json(errorResponse);
});

// Handle all other routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`,
    message: 'This endpoint does not exist'
  });
});

// Port configuration
const PORT = process.env.PORT || 3000;

// Start server with error handling
let server;
try {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log('🚀 SERVER STARTED SUCCESSFULLY');
    console.log('🚀 ================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🕐 Started at: ${new Date().toISOString()}`);
    console.log(`📁 Uploads directory: ${uploadDir}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log('🚀 ================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use`);
      process.exit(1);
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });

  // Graceful shutdown handling
  const gracefulShutdown = (signal) => {
    console.log(`\n📴 Received ${signal}. Graceful shutdown initiated...`);
    
    server.close(() => {
      console.log('📴 HTTP server closed');
      
      mongoose.connection.close(false, () => {
        console.log('📴 MongoDB connection closed');
        console.log('📴 Graceful shutdown completed');
        process.exit(0);
      });
    });

    // Force close server after 30 seconds
    setTimeout(() => {
      console.error('📴 Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}

// Export app for testing
module.exports = app;