module.exports = {
  validateVideoFile: (file) => {
    const validTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska'
    ];
    
    if (!file) {
      throw new Error('No file provided');
    }
    
    if (!validTypes.includes(file.mimetype)) {
      throw new Error('Unsupported file type');
    }
    
    return true;
  }
};