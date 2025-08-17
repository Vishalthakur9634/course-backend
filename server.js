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

// Enhanced CORS configuration for different endpoints
const generalCorsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000', 
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ],
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
    'User-Agent'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Content-Type',
    'Cache-Control',
    'Last-Modified',
    'ETag'
  ],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours preflight cache
};

// Special CORS configuration for video streaming endpoints
const videoCorsOptions = {
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000', 
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ],
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
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
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
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
  maxAge: 86400
};

// Apply general CORS middleware first
app.use(cors(generalCorsOptions));

// Enhanced logging for debugging CORS issues
app.use(morgan('combined'));

// Custom middleware to handle CORS for video endpoints specifically
app.use('/api/videos/stream', (req, res, next) => {
  // Set CORS headers explicitly for video streaming
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:5173', 
    'http://localhost:3000', 
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
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
    'User-Agent'
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
    return res.status(200).end();
  }
  
  next();
});

// Additional middleware for handling Range requests (important for video streaming)
app.use((req, res, next) => {
  // Enable CORS for all requests
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', [
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
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.header('Access-Control-Expose-Headers', [
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'Content-Type',
    'Cache-Control',
    'Last-Modified',
    'ETag'
  ].join(', '));
  
  next();
});

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files with proper headers for video streaming
app.use('/uploads', (req, res, next) => {
  // Set appropriate headers for video files
  if (req.path.endsWith('.mp4') || req.path.endsWith('.m3u8') || req.path.endsWith('.ts')) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', req.path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Handle all OPTIONS requests globally
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);

// Basic route for testing
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API is running successfully',
    cors: 'Enhanced CORS configuration active'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    cors: {
      origin: req.headers.origin,
      userAgent: req.headers['user-agent'],
      method: req.method
    }
  });
});

// Enhanced error handler with CORS support
app.use((err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Ensure CORS headers are set even for errors
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  console.error('Error:', err);

  // Mongoose errors
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  } else if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  } else if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = { message, statusCode: 400 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error'
  });
});

// Handle unhandled routes
app.all('*', (req, res) => {
  // Ensure CORS headers for 404s
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`
  });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log('Enhanced CORS configuration loaded');
  console.log('Video streaming CORS headers configured');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});