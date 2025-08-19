const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables first
dotenv.config({ path: './config/config.env' });

const app = express();

// Server state tracking
let isServerReady = false;
let isShuttingDown = false;

// Enhanced error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Details:');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Stack trace:', err.stack);
  
  // Attempt graceful shutdown
  if (server && !isShuttingDown) {
    isShuttingDown = true;
    console.log('🔄 Attempting graceful shutdown...');
    server.close(() => {
      process.exit(1);
    });
    
    // Force exit after 5 seconds
    setTimeout(() => {
      console.error('⚠️ Force exit after timeout');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(1);
  }
});

// Enhanced error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  
  // Don't exit immediately, log and continue
  if (reason && reason.name === 'MongoNetworkError') {
    console.log('🔄 MongoDB network error detected, will retry connection...');
    return;
  }
  
  if (!isShuttingDown) {
    isShuttingDown = true;
    console.log('🔄 Attempting graceful shutdown due to unhandled rejection...');
    
    if (server) {
      server.close(() => {
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  }
});

// Robust database connection with exponential backoff
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

const connectDB = async () => {
  try {
    console.log('🔄 Attempting to connect to MongoDB...');
    
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }

    // Compatible connection options
    const connectionOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 15000, // 15 seconds
      socketTimeoutMS: 45000, // 45 seconds
      connectTimeoutMS: 10000, // 10 seconds
      maxPoolSize: 10, // Maintain up to 10 socket connections
      retryWrites: true,
      retryReads: true,
      bufferCommands: false, // Disable mongoose buffering
      bufferMaxEntries: 0 // Disable mongoose buffering
    };
    
    const conn = await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database Name: ${conn.connection.name}`);
    
    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;
    
    // Set up connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
      if (!isShuttingDown) {
        setTimeout(connectDB, 5000);
      }
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });
    
    return conn;
    
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('💥 Max reconnection attempts reached. Exiting...');
      process.exit(1);
    }
    
    // Exponential backoff: 2^attempt * 1000ms, max 30 seconds
    const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, 30000);
    console.log(`🔄 Retrying database connection in ${delay/1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(connectDB, delay);
  }
};

// Initialize database connection
connectDB();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Created uploads directory:', uploadDir);
  }
} catch (error) {
  console.error('❌ Error creating uploads directory:', error);
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
      // Don't block in development, just warn
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

// Apply CORS middleware with error handling
app.use((req, res, next) => {
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      console.error('CORS Error:', err.message);
      return res.status(403).json({
        success: false,
        error: 'CORS policy violation',
        origin: req.headers.origin
      });
    }
    next();
  });
});

// Server readiness check middleware
app.use((req, res, next) => {
  if (isShuttingDown) {
    return res.status(503).json({
      success: false,
      error: 'Server is shutting down',
      message: 'Please try again in a moment'
    });
  }
  next();
});

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.log('⏰ Request timeout:', req.url);
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Request timeout'
      });
    }
  });
  next();
});

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Request logging middleware with error handling
app.use((req, res, next) => {
  try {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  } catch (error) {
    console.error('Logging error:', error);
  }
  next();
});

// Body parsing middleware with error handling
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      console.error('JSON Parse Error:', e.message);
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

app.use(cookieParser());

// Serve uploaded files with proper error handling
app.use('/uploads', (req, res, next) => {
  express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
      try {
        if (filePath.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/mp2t');
          res.setHeader('Accept-Ranges', 'bytes');
        }
      } catch (error) {
        console.error('Error setting headers:', error);
      }
    },
    fallthrough: false // Don't fall through to next middleware on file not found
  })(req, res, (err) => {
    if (err) {
      console.error('Static file serving error:', err);
      res.status(404).json({
        success: false,
        error: 'File not found'
      });
    } else {
      next();
    }
  });
});

// Health check endpoints with comprehensive status
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Course Backend API is running',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    serverReady: isServerReady,
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const isHealthy = dbStatus === 1 && !isShuttingDown;
  
  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    message: isHealthy ? 'Server is healthy' : 'Server is not ready',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      status: dbStatus === 1 ? 'Connected' : 'Disconnected',
      readyState: dbStatus
    },
    server: {
      ready: isServerReady,
      shuttingDown: isShuttingDown
    }
  });
});

// API health check with CORS information
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const isHealthy = dbStatus === 1 && !isShuttingDown;
  
  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    message: isHealthy ? 'API is healthy' : 'API is not ready',
    cors: {
      allowedOrigins: allowedOrigins,
      yourOrigin: req.headers.origin || 'none',
      isAllowed: !req.headers.origin || allowedOrigins.includes(req.headers.origin)
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Readiness probe (for load balancers)
app.get('/ready', (req, res) => {
  if (mongoose.connection.readyState === 1 && isServerReady && !isShuttingDown) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

// Liveness probe (for load balancers)
app.get('/alive', (req, res) => {
  if (!isShuttingDown) {
    res.status(200).json({ alive: true });
  } else {
    res.status(503).json({ alive: false });
  }
});

// Import routes with enhanced error handling
let authRoutes, videoRoutes;

const createFallbackRouter = (routeName) => {
  const router = express.Router();
  router.all('*', (req, res) => {
    res.status(503).json({
      success: false,
      error: `${routeName} routes not available`,
      message: 'Service temporarily unavailable'
    });
  });
  return router;
};

try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading auth routes:', error.message);
  authRoutes = createFallbackRouter('Auth');
}

try {
  videoRoutes = require('./routes/videoRoutes');
  console.log('✅ Video routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading video routes:', error.message);
  videoRoutes = createFallbackRouter('Video');
}

// Apply routes with error handling
app.use('/api/auth', (req, res, next) => {
  try {
    authRoutes(req, res, next);
  } catch (error) {
    console.error('Auth route error:', error);
    res.status(500).json({
      success: false,
      error: 'Auth service error'
    });
  }
});

app.use('/api/videos', (req, res, next) => {
  try {
    videoRoutes(req, res, next);
  } catch (error) {
    console.error('Video route error:', error);
    res.status(500).json({
      success: false,
      error: 'Video service error'
    });
  }
});

// Test route with comprehensive information
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API test endpoint working',
    timestamp: new Date().toISOString(),
    server: {
      ready: isServerReady,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
      readyState: mongoose.connection.readyState
    },
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      ip: req.ip
    }
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
      'GET /ready',
      'GET /alive',
      'GET /api/health',
      'GET /api/test',
      'ALL /api/auth/*',
      'ALL /api/videos/*'
    ]
  });
});

// Global error handler with enhanced logging
app.use((err, req, res, next) => {
  console.error('🔥 Global error handler triggered:');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Request URL:', req.url);
  console.error('Request method:', req.method);
  console.error('Request headers:', req.headers);
  console.error('Stack trace:', err.stack);
  
  // Handle specific error types
  let statusCode = err.statusCode || 500;
  let errorMessage = err.message || 'Internal Server Error';
  
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorMessage = 'Validation Error';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    errorMessage = 'Invalid ID format';
  } else if (err.code === 11000) {
    statusCode = 400;
    errorMessage = 'Duplicate field value';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorMessage = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorMessage = 'Token expired';
  }
  
  const errorResponse = {
    success: false,
    error: errorMessage,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.details = {
      name: err.name,
      code: err.code
    };
  }

  // Don't send response if headers already sent
  if (!res.headersSent) {
    res.status(statusCode).json(errorResponse);
  }
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

// Start server with enhanced error handling and health checks
let server;

const startServer = () => {
  try {
    server = app.listen(PORT, '0.0.0.0', () => {
      isServerReady = true;
      console.log('\n🚀 ================================');
      console.log('🚀 SERVER STARTED SUCCESSFULLY');
      console.log('🚀 ================================');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🕐 Started at: ${new Date().toISOString()}`);
      console.log(`📁 Uploads directory: ${uploadDir}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 Ready check: http://localhost:${PORT}/ready`);
      console.log(`🔗 API test: http://localhost:${PORT}/api/test`);
      console.log('🚀 ================================\n');
    });

    // Configure server timeouts
    server.timeout = 30000; // 30 seconds
    server.keepAliveTimeout = 65000; // 65 seconds
    server.headersTimeout = 66000; // 66 seconds

    server.on('error', (err) => {
      console.error('❌ Server error:', err);
      
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('🔄 Trying to start on next available port...');
        
        // Try next port
        const newPort = parseInt(PORT) + 1;
        process.env.PORT = newPort.toString();
        setTimeout(startServer, 1000);
      } else {
        console.error('❌ Server startup failed:', err);
        process.exit(1);
      }
    });

    server.on('clientError', (err, socket) => {
      console.error('Client error:', err);
      if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });

    server.on('connection', (socket) => {
      socket.on('error', (err) => {
        console.error('Socket error:', err);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    setTimeout(startServer, 2000); // Retry after 2 seconds
  }
};

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\n📴 Received ${signal}. Graceful shutdown initiated...`);
  isShuttingDown = true;
  
  if (server) {
    // Stop accepting new requests
    server.close((err) => {
      if (err) {
        console.error('Error closing server:', err);
      } else {
        console.log('📴 HTTP server closed');
      }
      
      // Close database connection
      mongoose.connection.close(false, (err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('📴 MongoDB connection closed');
        }
        
        console.log('📴 Graceful shutdown completed');
        process.exit(0);
      });
    });

    // Force close server after 10 seconds
    setTimeout(() => {
      console.error('📴 Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

// Export app for testing
module.exports = app;