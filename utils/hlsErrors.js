module.exports = {
  handleHlsError: (error) => {
    if (error.message.includes('404') || error.code === 'ENOENT') {
      return 'Video file not found on server';
    }
    if (error.message.includes('HLS') || error.message.includes('stream')) {
      return 'Video streaming error';
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return 'File too large (max 500MB)';
    }
    return 'Video processing error';
  }
};
