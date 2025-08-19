const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const router = express.Router();

// Import Video model (adjust path as needed)
const Video = require('../models/Video');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadDir);
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/quicktime'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
}).single('video');

// Simplified renditions for faster processing and stability
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
    bandwidth: '1200k',
    audioBitrate: '96k',
    folderName: '480p',
    playlistName: 'index.m3u8'
  }
];

// Function to get video duration with timeout
const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('Duration detection timeout, defaulting to 0');
      resolve(0);
    }, 20000); // 20 seconds timeout

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        console.error('FFprobe error:', err);
        resolve(0); // Default to 0 if cannot get duration
      } else {
        const duration = metadata?.format?.duration || 0;
        resolve(Math.round(duration));
      }
    });
  });
};

// Test route to verify the router is working
router.get('/test', (req, res) => {
  console.log('🧪 Video test route hit!');
  res.json({
    success: true,
    message: 'Video routes are working',
    uploadDir: uploadDir,
    timestamp: new Date().toISOString()
  });
});

// Main upload route - KEEPS THE SAME RESPONSE FORMAT AS YOUR ORIGINAL
router.post('/upload', (req, res) => {
  console.log('🚀 Upload route hit!');
  
  // Increase timeout for this specific route
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes

  upload(req, res, async (err) => {
    let inputFilePath = req.file?.path;
    let outputDir;

    try {
      // Handle upload errors
      if (err instanceof multer.MulterError) {
        console.error('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
          throw new Error('File size too large. Maximum size is 500MB.');
        }
        throw new Error(`Upload error: ${err.message}`);
      } else if (err) {
        console.error('Upload error:', err);
        throw err;
      }
      
      if (!req.file) {
        throw new Error("No file uploaded");
      }

      console.log('📤 File uploaded:', req.file.originalname);
      console.log('📁 Temporary path:', inputFilePath);

      const videoId = new mongoose.Types.ObjectId();
      outputDir = path.join(uploadDir, videoId.toString());

      console.log('🎬 Processing video with ID:', videoId);
      console.log('📂 Output directory:', outputDir);

      // Create output directory
      await fsp.mkdir(outputDir, { recursive: true });

      // Get video duration first
      let duration = 0;
      try {
        duration = await getVideoDuration(inputFilePath);
        console.log('⏱️ Video duration:', duration, 'seconds');
      } catch (durationError) {
        console.warn('⚠️ Could not get video duration:', durationError.message);
      }

      // Process renditions with optimized settings for stability
      const processingPromises = renditions.map((rendition, index) => {
        const renditionDir = path.join(outputDir, rendition.folderName);
        
        return new Promise((resolve, reject) => {
          // Add delay between processing to prevent resource conflicts
          setTimeout(() => {
            fsp.mkdir(renditionDir, { recursive: true })
              .then(() => {
                console.log(`🔄 Starting ${rendition.resolution} processing...`);
                
                const command = ffmpeg(inputFilePath)
                  .outputOptions([
                    '-c:v libx264',
                    '-c:a aac',
                    '-profile:v baseline',
                    '-level 3.0',
                    '-pix_fmt yuv420p',
                    '-crf 23',
                    '-preset ultrafast', // Fastest preset for stability
                    '-threads 1', // Single thread to prevent overload
                    `-b:v ${rendition.bandwidth}`,
                    `-b:a ${rendition.audioBitrate}`,
                    `-vf scale=${rendition.resolution}:force_original_aspect_ratio=decrease,pad=${rendition.resolution}:(ow-iw)/2:(oh-ih)/2`,
                    '-hls_time 6', // Longer segments for stability
                    '-hls_list_size 0',
                    '-hls_flags independent_segments',
                    `-hls_segment_filename ${path.join(renditionDir, 'segment_%03d.ts')}`,
                    '-f hls'
                  ])
                  .output(path.join(renditionDir, rendition.playlistName))
                  .on('start', (commandLine) => {
                    console.log(`🎯 Started processing ${rendition.resolution}`);
                  })
                  .on('progress', (progress) => {
                    if (progress.percent && progress.percent > 0) {
                      const percent = Math.floor(progress.percent);
                      if (percent % 25 === 0) { // Log every 25%
                        console.log(`⏳ Processing ${rendition.resolution}: ${percent}% done`);
                      }
                    }
                  })
                  .on('end', () => {
                    console.log(`✅ Finished processing ${rendition.resolution}`);
                    resolve();
                  })
                  .on('error', (err) => {
                    console.error(`❌ Error processing ${rendition.resolution}:`, err.message);
                    reject(err);
                  });

                command.run();
              })
              .catch(reject);
          }, index * 2000); // 2 second delay between each rendition
        });
      });

      try {
        await Promise.all(processingPromises);
        console.log('🎉 All renditions processed successfully');
      } catch (processingError) {
        console.error('Processing error:', processingError);
        // Continue with single rendition if multiple fail
        throw new Error('Video processing failed. Please try with a smaller file or different format.');
      }

      // Create master playlist
      const masterContent = [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        ...renditions.map(r => [
          `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(r.bandwidth)*1000},RESOLUTION=${r.resolution},CODECS="avc1.64001f,mp4a.40.2"`,
          `${r.folderName}/${r.playlistName}`
        ].join('\n'))
      ].join('\n');

      const masterPath = path.join(outputDir, 'master.m3u8');
      await fsp.writeFile(masterPath, masterContent);
      console.log('📝 Master playlist created');

      // Save to database
      const video = new Video({
        _id: videoId,
        title: req.body.title || path.parse(req.file.originalname).name,
        description: req.body.description || '',
        originalFileName: req.file.originalname,
        filePath: `${videoId}/master.m3u8`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        duration: duration,
        renditions: renditions.map(r => ({
          resolution: r.resolution,
          bandwidth: parseInt(r.bandwidth) * 1000,
          playlistPath: `${videoId}/${r.folderName}/${r.playlistName}`
        }))
      });

      await video.save();
      console.log('💾 Video saved to database');

      // Cleanup original file
      if (inputFilePath) {
        try {
          await fsp.unlink(inputFilePath);
          console.log('🗑️ Original file cleaned up');
        } catch (cleanupErr) {
          console.error('⚠️ Original file cleanup error:', cleanupErr);
        }
      }

      // RETURN THE SAME FORMAT YOUR FRONTEND EXPECTS
      res.status(201).json({
        success: true,
        message: "Video processed successfully",
        video: {
          ...video.toObject(),
          hlsPlaylist: `/api/videos/stream/${video._id}/master.m3u8`
        }
      });

    } catch (error) {
      console.error('❌ Upload error:', error);
      
      // Comprehensive cleanup on error
      const cleanup = async () => {
        if (inputFilePath && fs.existsSync(inputFilePath)) {
          try {
            await fsp.unlink(inputFilePath);
            console.log('🗑️ Input file cleaned up after error');
          } catch (err) {
            console.error('⚠️ Error deleting input file:', err);
          }
        }
        
        if (outputDir && fs.existsSync(outputDir)) {
          try {
            await fsp.rm(outputDir, { recursive: true, force: true });
            console.log('🗑️ Output directory cleaned up after error');
          } catch (err) {
            console.error('⚠️ Error deleting output directory:', err);
          }
        }
      };

      await cleanup();

      // Return error in the same format your frontend expects
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false,
          error: error.message,
          ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
      }
    }
  });
});

// Route to get all videos - SAME FORMAT AS ORIGINAL
router.get('/', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    
    const videosWithUrls = videos.map(video => ({
      ...video.toObject(),
      hlsPlaylist: `/api/videos/stream/${video._id}/master.m3u8`
    }));
    
    res.json({
      success: true,
      videos: videosWithUrls
    });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route to get single video - SAME FORMAT AS ORIGINAL
router.get('/:id', async (req, res) => {
  try {
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
        hlsPlaylist: `/api/videos/stream/${video._id}/master.m3u8`
      }
    });
  } catch (error) {
    console.error('Get single video error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Streaming route - MATCHES YOUR ORIGINAL PATTERN
router.get('/stream/:id/:file(*)', async (req, res) => {
  try {
    const { id, file } = req.params;
    const filePath = path.join(uploadDir, id, file);
    
    console.log('🎬 Streaming request for:', filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error('File not found:', filePath);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // Set appropriate content type and headers
    if (file.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else if (file.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Accept-Ranges', 'bytes');
    }
    
    // Send file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error streaming file'
          });
        }
      }
    });
    
  } catch (error) {
    console.error('Streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Streaming error'
      });
    }
  }
});

module.exports = router;