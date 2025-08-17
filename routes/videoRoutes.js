const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const mongoose = require('mongoose');

// ========== CRITICAL FFMPEG CONFIGURATION ==========
// Method 1: Use ffmpeg-static package (preferred)
try {
  const ffmpegPath = require('ffmpeg-static');
  const ffprobePath = require('@ffprobe-installer/ffprobe').path;
  
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);
  
  console.log('FFmpeg path set to:', ffmpegPath);
  console.log('FFprobe path set to:', ffprobePath);
} catch (err) {
  console.error('Error setting FFmpeg paths from packages:', err);
  
  // Method 2: Fallback to system PATH
  console.log('Falling back to system PATH for FFmpeg');
  
  // Verify FFmpeg is in system PATH
  const isWin = process.platform === 'win32';
  const ffmpegCommand = isWin ? 'where ffmpeg' : 'which ffmpeg';
  
  require('child_process').exec(ffmpegCommand, (error, stdout) => {
    if (error) {
      console.error('FFmpeg not found in system PATH!');
      throw new Error('FFmpeg not found. Please install FFmpeg and add it to your PATH');
    }
    console.log('Found FFmpeg at:', stdout.trim());
  });
}

// Video Model Schema
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
  }],
  createdAt: { type: Date, default: Date.now }
});
const Video = mongoose.model('Video', videoSchema);

// Configure upload directory
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Improved Multer configuration
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const validMimes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm'
  ];
  
  if (!validMimes.includes(file.mimetype)) {
    return cb(new Error('Invalid file type. Only video files are allowed.'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { 
    fileSize: 500 * 1024 * 1024 // 500MB
  }
}).single('video');

// Video renditions configuration
const renditions = [
  {
    resolution: '640x360',
    bandwidth: '800k',
    audioBitrate: '96k',
    playlistName: '360p.m3u8',
    folderName: '360p'
  },
  {
    resolution: '854x480',
    bandwidth: '1400k',
    audioBitrate: '128k',
    playlistName: '480p.m3u8',
    folderName: '480p'
  },
  {
    resolution: '1280x720',
    bandwidth: '2800k',
    audioBitrate: '128k',
    playlistName: '720p.m3u8',
    folderName: '720p'
  }
];

// Improved getVideoDuration with timeout
const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('FFprobe timed out after 30 seconds'));
    }, 30000);

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
};

// Enhanced upload endpoint
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

      const videoId = new mongoose.Types.ObjectId();
      outputDir = path.join(uploadDir, videoId.toString());

      // Create output directory
      await fsp.mkdir(outputDir, { recursive: true });

      // Process renditions with progress tracking
      const processingPromises = renditions.map(rendition => {
        const renditionDir = path.join(outputDir, rendition.folderName);
        
        return new Promise((resolve, reject) => {
          // Create rendition directory
          fsp.mkdir(renditionDir, { recursive: true })
            .then(() => {
              const command = ffmpeg(req.file.path)
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
                  console.log(`Started processing ${rendition.resolution}: ${commandLine}`);
                })
                .on('progress', (progress) => {
                  console.log(`Processing ${rendition.resolution}: ${Math.floor(progress.percent)}% done`);
                })
                .on('end', () => {
                  console.log(`Finished processing ${rendition.resolution}`);
                  resolve();
                })
                .on('error', (err) => {
                  console.error(`Error processing ${rendition.resolution}:`, err);
                  reject(err);
                });

              command.run();
            })
            .catch(reject);
        });
      });

      await Promise.all(processingPromises);

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

      // Get video duration with timeout
      const duration = await getVideoDuration(req.file.path);

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

      // Cleanup original file
      if (inputFilePath) {
        try {
          await fsp.unlink(inputFilePath);
        } catch (cleanupErr) {
          console.error('Original file cleanup error:', cleanupErr);
        }
      }

      res.status(201).json({
        success: true,
        message: "Video processed successfully",
        video: {
          ...video.toObject(),
          hlsPlaylist: `/api/videos/stream/${video._id}/master.m3u8`
        }
      });

    } catch (error) {
      console.error('Upload error:', error);
      
      // Comprehensive cleanup on error
      const cleanup = async () => {
        if (inputFilePath && fs.existsSync(inputFilePath)) {
          try {
            await fsp.unlink(inputFilePath);
          } catch (err) {
            console.error('Error deleting input file:', err);
          }
        }
        
        if (outputDir && fs.existsSync(outputDir)) {
          try {
            await fsp.rm(outputDir, { recursive: true, force: true });
          } catch (err) {
            console.error('Error deleting output directory:', err);
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

// Stream video endpoint
router.get('/stream/:id/:filename(*)', async (req, res) => {
  try {
    const { id, filename = 'master.m3u8' } = req.params;
    
    console.log(`Stream request for video ${id}, file: ${filename}`);

    // Find video in database
    const video = await Video.findById(id);
    if (!video) {
      console.error('Video not found in database');
      return res.status(404).json({ error: 'Video not found' });
    }

    // Build file path
    let filePath;
    if (filename === 'master.m3u8') {
      filePath = path.join(uploadDir, video.filePath);
    } else {
      const videoDir = path.dirname(path.join(uploadDir, video.filePath));
      filePath = path.join(videoDir, filename);
    }

    console.log('Attempting to serve file:', filePath);

    // Verify file exists
    try {
      await fsp.access(filePath);
    } catch (err) {
      console.error('File access error:', err);
      return res.status(404).json({ 
        error: 'File not found',
        details: {
          requestedPath: filePath,
          videoId: id,
          filename: filename
        }
      });
    }

    

    // Set proper content type
    const contentType = filename.endsWith('.m3u8') 
      ? 'application/vnd.apple.mpegurl'
      : filename.endsWith('.ts') 
        ? 'video/MP2T'
        : 'application/octet-stream';

    // Set headers
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    // Stream the file
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).end();
    });
    stream.pipe(res);

  } catch (error) {
    console.error('Stream endpoint error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper function to debug directory contents
async function getDirectoryContents(dirPath) {
  try {
    return await fsp.readdir(dirPath);
  } catch (err) {
    return `Could not read directory: ${err.message}`;
  }
}

// Get all videos
router.get('/', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: videos.length,
      videos: videos.map(video => ({
        ...video.toObject(),
        hlsPlaylist: `/api/videos/stream/${video._id}/master.m3u8`
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching videos",
      error: error.message 
    });
  }
});

// Get single video
router.get('/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: "Video not found" 
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
    res.status(500).json({ 
      success: false,
      message: "Error fetching video",
      error: error.message 
    });
  }
});

// Delete video
router.delete('/:id', async (req, res) => {
  try {
    const video = await Video.findByIdAndDelete(req.params.id);
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: "Video not found" 
      });
    }

    const videoDir = path.join(uploadDir, path.dirname(video.filePath));
    if (fs.existsSync(videoDir)) {
      await fsp.rm(videoDir, { recursive: true, force: true });
    }

    res.json({ 
      success: true,
      message: "Video deleted successfully" 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: "Error deleting video",
      error: error.message 
    });
  }
});

module.exports = router;