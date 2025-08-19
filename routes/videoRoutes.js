const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const router = express.Router();

// Import Video model at the top to avoid import issues
let Video;
try {
  Video = require('../models/Video');
  console.log('✅ Video model loaded successfully');
} catch (error) {
  console.error('❌ Error loading Video model:', error.message);
  // Create a fallback schema if model doesn't exist
  const videoSchema = new mongoose.Schema({
    title: String,
    description: String,
    originalFileName: String,
    filePath: String,
    fileSize: Number,
    mimeType: String,
    duration: Number,
    renditions: [{
      resolution: String,
      bandwidth: Number,
      playlistPath: String
    }]
  }, { timestamps: true });
  
  Video = mongoose.model('Video', videoSchema);
}

// Ensure uploads directory exists with better error handling
const uploadDir = path.join(__dirname, '../uploads');
const ensureUploadDir = async () => {
  try {
    if (!fs.existsSync(uploadDir)) {
      await fsp.mkdir(uploadDir, { recursive: true });
      console.log('📁 Created uploads directory:', uploadDir);
    }
  } catch (error) {
    console.error('❌ Error creating uploads directory:', error);
  }
};

ensureUploadDir();

// Set FFmpeg path for Render deployment
try {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);
  console.log('✅ FFmpeg paths configured');
} catch (error) {
  console.error('⚠️ FFmpeg configuration warning:', error.message);
}

// Multer configuration with better error handling
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure directory exists before storing
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    try {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `video-${uniqueSuffix}${extension}`);
    } catch (error) {
      cb(error);
    }
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // Reduced to 100MB for Render
  },
  fileFilter: (req, file, cb) => {
    console.log('📹 Uploaded file type:', file.mimetype);
    const allowedMimes = [
      'video/mp4', 
      'video/avi', 
      'video/mov', 
      'video/wmv', 
      'video/flv',
      'video/quicktime',
      'video/x-msvideo'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only video files are allowed.`));
    }
  }
});

// Simplified renditions for Render (fewer to avoid timeout)
const renditions = [
  {
    resolution: '1280x720',
    bandwidth: '2500k',
    audioBitrate: '128k',
    folderName: '720p',
    playlistName: 'index.m3u8'
  },
  {
    resolution: '854x480',
    bandwidth: '1500k',
    audioBitrate: '96k',
    folderName: '480p',
    playlistName: 'index.m3u8'
  }
];

// Function to get video duration with timeout
const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Duration detection timeout'));
    }, 15000); // Reduced timeout for Render

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        console.error('FFprobe error:', err);
        resolve(0); // Default duration if detection fails
      } else {
        resolve(Math.round(metadata.format.duration || 0));
      }
    });
  });
};

// Test route to verify the router is working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Video routes are working',
    timestamp: new Date().toISOString(),
    uploadDir: uploadDir,
    uploadDirExists: fs.existsSync(uploadDir)
  });
});

// Health check route
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Video service is healthy',
    uploadDirectory: {
      path: uploadDir,
      exists: fs.existsSync(uploadDir)
    },
    ffmpeg: {
      configured: !!ffmpeg
    }
  });
});

// Video upload route with comprehensive error handling
router.post('/upload', (req, res) => {
  console.log('📤 Video upload request received');
  
  // Set response timeout
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Upload timeout'
      });
    }
  }, 300000); // 5 minutes timeout for Render

  upload.single('video')(req, res, async (err) => {
    clearTimeout(timeout);
    
    let inputFilePath = req.file?.path;
    let outputDir;

    try {
      // Handle upload errors
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          throw new Error('File too large. Maximum size is 100MB');
        }
        throw new Error(`Upload error: ${err.message}`);
      } else if (err) {
        throw err;
      }
      
      if (!req.file) {
        throw new Error("No file uploaded. Please select a video file.");
      }

      console.log('📤 File uploaded successfully:', req.file.originalname);
      console.log('📁 File size:', Math.round(req.file.size / 1024 / 1024), 'MB');
      console.log('📍 Temporary path:', inputFilePath);

      const videoId = new mongoose.Types.ObjectId();
      outputDir = path.join(uploadDir, videoId.toString());

      console.log('🎬 Processing video with ID:', videoId);

      // Create output directory
      await fsp.mkdir(outputDir, { recursive: true });

      // For Render deployment, let's try a simpler approach first
      // Check if FFmpeg is available
      let ffmpegAvailable = true;
      try {
        await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(inputFilePath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (ffmpegError) {
        console.error('❌ FFmpeg not available:', ffmpegError.message);
        ffmpegAvailable = false;
      }

      let duration = 0;
      
      if (ffmpegAvailable) {
        // Process video with FFmpeg
        console.log('🔄 Starting video processing...');
        
        // Get duration first
        try {
          duration = await getVideoDuration(inputFilePath);
          console.log('⏱️ Video duration:', duration, 'seconds');
        } catch (durationError) {
          console.error('⚠️ Duration detection failed:', durationError.message);
          duration = 0;
        }

        // Process renditions (simplified for Render)
        for (const rendition of renditions) {
          const renditionDir = path.join(outputDir, rendition.folderName);
          await fsp.mkdir(renditionDir, { recursive: true });

          console.log(`🔄 Processing ${rendition.resolution}...`);

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Processing timeout for ${rendition.resolution}`));
            }, 120000); // 2 minutes per rendition

            ffmpeg(inputFilePath)
              .outputOptions([
                '-c:v libx264',
                '-c:a aac',
                '-preset ultrafast', // Faster preset for Render
                '-crf 28', // Higher CRF for faster processing
                `-b:v ${rendition.bandwidth}`,
                `-b:a ${rendition.audioBitrate}`,
                `-vf scale=${rendition.resolution}`,
                '-hls_time 6', // Longer segments
                '-hls_list_size 0',
                '-hls_flags independent_segments',
                `-hls_segment_filename ${path.join(renditionDir, 'segment_%03d.ts')}`,
                '-f hls'
              ])
              .output(path.join(renditionDir, rendition.playlistName))
              .on('start', () => {
                console.log(`🎯 Started ${rendition.resolution}`);
              })
              .on('progress', (progress) => {
                if (progress.percent && progress.percent > 0) {
                  console.log(`⏳ ${rendition.resolution}: ${Math.floor(progress.percent)}%`);
                }
              })
              .on('end', () => {
                clearTimeout(timeout);
                console.log(`✅ Finished ${rendition.resolution}`);
                resolve();
              })
              .on('error', (err) => {
                clearTimeout(timeout);
                console.error(`❌ Error ${rendition.resolution}:`, err.message);
                reject(err);
              })
              .run();
          });
        }

        // Create master playlist
        const masterContent = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          ...renditions.map(r => [
            `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(r.bandwidth)*1000},RESOLUTION=${r.resolution}`,
            `${r.folderName}/${r.playlistName}`
          ].join('\n'))
        ].join('\n');

        const masterPath = path.join(outputDir, 'master.m3u8');
        await fsp.writeFile(masterPath, masterContent);
        console.log('📝 Master playlist created');
      } else {
        // Fallback: just move the original file if FFmpeg is not available
        console.log('⚠️ FFmpeg not available, storing original file');
        const originalPath = path.join(outputDir, 'original' + path.extname(req.file.originalname));
        await fsp.copyFile(inputFilePath, originalPath);
      }

      // Save to database
      const video = new Video({
        _id: videoId,
        title: req.body.title || path.parse(req.file.originalname).name,
        description: req.body.description || '',
        originalFileName: req.file.originalname,
        filePath: ffmpegAvailable ? `${videoId}/master.m3u8` : `${videoId}/original${path.extname(req.file.originalname)}`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        duration: duration,
        renditions: ffmpegAvailable ? renditions.map(r => ({
          resolution: r.resolution,
          bandwidth: parseInt(r.bandwidth) * 1000,
          playlistPath: `${videoId}/${r.folderName}/${r.playlistName}`
        })) : []
      });

      await video.save();
      console.log('💾 Video saved to database');

      // Cleanup original file
      if (inputFilePath) {
        try {
          await fsp.unlink(inputFilePath);
          console.log('🗑️ Temporary file cleaned up');
        } catch (cleanupErr) {
          console.error('⚠️ Cleanup warning:', cleanupErr.message);
        }
      }

      // Return success response
      const response = {
        success: true,
        message: ffmpegAvailable ? "Video processed successfully" : "Video uploaded successfully (processing unavailable)",
        video: {
          ...video.toObject(),
          playlistUrl: `/uploads/${video._id}/${ffmpegAvailable ? 'master.m3u8' : 'original' + path.extname(req.file.originalname)}`,
          streamingUrl: `/api/videos/stream/${video._id}/${ffmpegAvailable ? 'master.m3u8' : 'original' + path.extname(req.file.originalname)}`
        }
      };

      res.status(201).json(response);

    } catch (error) {
      console.error('❌ Upload error:', error);
      
      // Cleanup on error
      const cleanup = async () => {
        try {
          if (inputFilePath && fs.existsSync(inputFilePath)) {
            await fsp.unlink(inputFilePath);
            console.log('🗑️ Input file cleaned up');
          }
          
          if (outputDir && fs.existsSync(outputDir)) {
            await fsp.rm(outputDir, { recursive: true, force: true });
            console.log('🗑️ Output directory cleaned up');
          }
        } catch (cleanupError) {
          console.error('⚠️ Cleanup error:', cleanupError.message);
        }
      };

      await cleanup();

      // Return error response
      const statusCode = error.message.includes('timeout') ? 408 : 
                        error.message.includes('File too large') ? 413 : 500;

      if (!res.headersSent) {
        res.status(statusCode).json({ 
          success: false,
          error: error.message,
          ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
      }
    }
  });
});

// Route to get all videos
router.get('/', async (req, res) => {
  try {
    console.log('📋 Fetching all videos...');
    const videos = await Video.find().sort({ createdAt: -1 });
    
    const videosWithUrls = videos.map(video => ({
      ...video.toObject(),
      playlistUrl: `/uploads/${video._id}/${video.filePath.split('/').pop()}`,
      streamingUrl: `/api/videos/stream/${video._id}/${video.filePath.split('/').pop()}`
    }));
    
    res.json({
      success: true,
      count: videos.length,
      videos: videosWithUrls
    });
  } catch (error) {
    console.error('❌ Error fetching videos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route to get single video
router.get('/:id', async (req, res) => {
  try {
    console.log('🔍 Fetching video:', req.params.id);
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }
    
    res.json({
      success: true,
      video: {
        ...video.toObject(),
        playlistUrl: `/uploads/${video._id}/${video.filePath.split('/').pop()}`,
        streamingUrl: `/api/videos/stream/${video._id}/${video.filePath.split('/').pop()}`
      }
    });
  } catch (error) {
    console.error('❌ Error fetching video:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Streaming route with better error handling
router.get('/stream/:id/:file(*)', async (req, res) => {
  try {
    const { id, file } = req.params;
    const filePath = path.join(uploadDir, id, file);
    
    console.log('🎬 Streaming request for:', filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ File not found:', filePath);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // Set appropriate content type
    if (file.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (file.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=31536000');
    } else if (file.endsWith('.mp4')) {
      res.set('Content-Type', 'video/mp4');
      res.set('Accept-Ranges', 'bytes');
    }
    
    // Send file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('❌ Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error serving file'
          });
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Streaming error:', error);
    res.status(500).json({
      success: false,
      error: 'Streaming error'
    });
  }
});

// Delete video route
router.delete('/:id', async (req, res) => {
  try {
    console.log('🗑️ Deleting video:', req.params.id);
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }
    
    // Delete files
    const videoDir = path.join(uploadDir, video._id.toString());
    if (fs.existsSync(videoDir)) {
      await fsp.rm(videoDir, { recursive: true, force: true });
      console.log('🗑️ Video files deleted');
    }
    
    // Delete from database
    await Video.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Video deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting video:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;