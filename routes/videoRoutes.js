const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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
    const allowedMimes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
}).single('video');

// Video renditions configuration
const renditions = [
  {
    resolution: '1920x1080',
    bandwidth: '5000k',
    audioBitrate: '128k',
    folderName: '1080p',
    playlistName: 'index.m3u8'
  },
  {
    resolution: '1280x720',
    bandwidth: '3000k',
    audioBitrate: '96k',
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

// Function to get video duration
const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Duration detection timeout'));
    }, 30000);

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        reject(err);
      } else {
        resolve(Math.round(metadata.format.duration));
      }
    });
  });
};

// Video upload and processing route
router.post('/upload', (req, res) => {
  upload(req, res, async (err) => {
    let inputFilePath = req.file?.path;
    let outputDir;

    try {
      // Handle upload errors
      if (err instanceof multer.MulterError) {
        throw new Error(`Upload error: ${err.message}`);
      } else if (err) {
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

      // Process renditions with progress tracking
      const processingPromises = renditions.map(rendition => {
        const renditionDir = path.join(outputDir, rendition.folderName);
        
        return new Promise((resolve, reject) => {
          // Create rendition directory
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
                  '-preset veryfast',
                  `-b:v ${rendition.bandwidth}`,
                  `-b:a ${rendition.audioBitrate}`,
                  `-vf scale=${rendition.resolution}`,
                  '-hls_time 4',
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
                  if (progress.percent) {
                    console.log(`⏳ Processing ${rendition.resolution}: ${Math.floor(progress.percent)}% done`);
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
        });
      });

      await Promise.all(processingPromises);
      console.log('🎉 All renditions processed successfully');

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

      // Get video duration with timeout
      const duration = await getVideoDuration(inputFilePath);
      console.log('⏱️ Video duration:', duration, 'seconds');

      // Import Video model (make sure this is imported at the top of your file)
      const Video = require('../models/Video'); // Adjust path as needed

      // Save to database
      const video = new Video({
        _id: videoId,
        title: req.body.title || path.parse(req.file.originalname).name,
        description: req.body.description || '',
        originalFileName: req.file.originalname,
        filePath: `${videoId}/master.m3u8`, // This will be served from /uploads/${videoId}/master.m3u8
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

      // Return success response
      res.status(201).json({
        success: true,
        message: "Video processed successfully",
        video: {
          ...video.toObject(),
          // This URL should match your server setup
          hlsPlaylist: `/uploads/${video._id}/master.m3u8`, // Direct access to uploads
          streamingUrl: `/api/videos/stream/${video._id}/master.m3u8` // If you have a streaming route
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

      res.status(500).json({ 
        success: false,
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  });
});

// Route to get all videos
router.get('/', async (req, res) => {
  try {
    const Video = require('../models/Video');
    const videos = await Video.find().sort({ createdAt: -1 });
    
    const videosWithUrls = videos.map(video => ({
      ...video.toObject(),
      hlsPlaylist: `/uploads/${video._id}/master.m3u8`,
      streamingUrl: `/api/videos/stream/${video._id}/master.m3u8`
    }));
    
    res.json({
      success: true,
      videos: videosWithUrls
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route to get single video
router.get('/:id', async (req, res) => {
  try {
    const Video = require('../models/Video');
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
        hlsPlaylist: `/uploads/${video._id}/master.m3u8`,
        streamingUrl: `/api/videos/stream/${video._id}/master.m3u8`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Streaming route (optional - if you want a separate streaming endpoint)
router.get('/stream/:id/:file(*)', async (req, res) => {
  try {
    const { id, file } = req.params;
    const filePath = path.join(uploadDir, id, file);
    
    console.log('🎬 Streaming request for:', filePath);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // Set appropriate content type
    if (file.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (file.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
    }
    
    // Set caching headers
    res.set('Cache-Control', 'no-cache');
    
    // Send file
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({
      success: false,
      error: 'Streaming error'
    });
  }
});

module.exports = router;