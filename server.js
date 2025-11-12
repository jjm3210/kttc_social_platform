const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5500;

// Initialize Firebase Admin SDK
// Using service account file (same directory as server.js)
try {
    const serviceAccount = require('./kttc-hub-auth-firebase-adminsdk-fbsvc-9939be2aa0.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'kttc-hub-auth' // Explicitly set project ID to match client config
    });
    console.log('Firebase Admin SDK initialized from service account file');
    console.log('Project ID:', serviceAccount.project_id);
} catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    console.warn('Custom token endpoint will not work without Firebase Admin SDK.');
    // Try fallback to environment variable if file doesn't exist
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin SDK initialized from environment variable (fallback)');
        } catch (envError) {
            console.error('Error initializing from environment variable:', envError);
        }
    }
}

// Enable CORS - Allow all origins for development (restrict in production)
app.use(cors({
    origin: true, // Allow all origins for development
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files from the current directory (where server.js is located)
// This will make social-platform.html, social-platform.css, and social-platform.js accessible.
app.use(express.static(__dirname));

// For the root URL, send the social-platform.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'social-platform.html'));
});

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'social-posts');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`Created upload directory: ${UPLOAD_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const tempDir = path.join(UPLOAD_DIR, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // Generate a unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

// File filter - only allow images and videos
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image and video files are allowed!'));
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB max file size - adjust as needed
    },
    fileFilter: fileFilter
});

// POST /api/upload - Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        console.log('Upload request received');
        console.log('Body:', req.body);
        console.log('File:', req.file);
        
        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }
        
        if (!req.body.postId) {
            console.error('No postId in request');
            // Delete the temp file if postId is missing
            if (req.file && req.file.path) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (e) {
                    console.error('Error deleting temp file:', e);
                }
            }
            return res.status(400).json({
                success: false,
                error: 'postId is required'
            });
        }
        
        // Move file from temp directory to post-specific directory
        const postId = req.body.postId;
        const postDir = path.join(UPLOAD_DIR, postId);
        
        // Create post-specific directory if it doesn't exist
        if (!fs.existsSync(postDir)) {
            fs.mkdirSync(postDir, { recursive: true });
        }
        
        // Use the filename from the request body, or keep the generated one
        const finalFilename = req.body.filename || req.file.filename;
        const safeFilename = path.basename(finalFilename);
        const finalPath = path.join(postDir, safeFilename);
        
        // Move file from temp to final location
        fs.renameSync(req.file.path, finalPath);
        
        console.log(`File uploaded: ${safeFilename} to ${finalPath}`);
        
        res.json({
            success: true,
            message: 'File uploaded successfully',
            filename: safeFilename,
            path: finalPath
        });
    } catch (error) {
        console.error('Upload error:', error);
        console.error('Error stack:', error.stack);
        
        // Clean up temp file on error
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {
                console.error('Error deleting temp file:', e);
            }
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to upload file'
        });
    }
});

// GET /api/files/:postId/:filename - Download file
app.get('/api/files/:postId/:filename', (req, res) => {
    try {
        const { postId, filename } = req.params;
        
        // Sanitize inputs to prevent path traversal
        const safePostId = path.basename(postId);
        const safeFilename = path.basename(filename);
        
        const filePath = path.join(UPLOAD_DIR, safePostId, safeFilename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log(`File not found: ${filePath}`);
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }
        
        // Determine content type
        const ext = path.extname(safeFilename).toLowerCase();
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska'
        };
        
        const contentType = contentTypes[ext] || 'application/octet-stream';
        
        // Set headers and send file
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
        res.sendFile(filePath);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to download file'
        });
    }
});

// DELETE /api/files/:postId/:filename - Delete file
app.delete('/api/files/:postId/:filename', (req, res) => {
    try {
        const { postId, filename } = req.params;
        
        // Sanitize inputs to prevent path traversal
        const safePostId = path.basename(postId);
        const safeFilename = path.basename(filename);
        
        const filePath = path.join(UPLOAD_DIR, safePostId, safeFilename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }
        
        // Delete file
        fs.unlinkSync(filePath);
        console.log(`File deleted: ${filePath}`);
        
        // Optionally delete post directory if empty
        const postDir = path.join(UPLOAD_DIR, safePostId);
        try {
            const files = fs.readdirSync(postDir);
            if (files.length === 0) {
                fs.rmdirSync(postDir);
                console.log(`Removed empty directory: ${postDir}`);
            }
        } catch (err) {
            // Directory not empty or other error - that's okay
        }
        
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete file'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API is running',
        uploadDir: UPLOAD_DIR
    });
});

// POST /api/create-custom-token - Create custom token from ID token
// This endpoint allows the hub to exchange an ID token for a custom token
// which can be used to authenticate on the social platform
app.post('/api/create-custom-token', async (req, res) => {
    try {
        const { idToken } = req.body;
        
        if (!idToken) {
            return res.status(400).json({
                success: false,
                error: 'ID token is required'
            });
        }
        
        // Verify the ID token
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Error verifying ID token:', error);
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired ID token'
            });
        }
        
        // Create custom token for the user
        const customToken = await admin.auth().createCustomToken(decodedToken.uid);
        
        // Validate the custom token format
        if (!customToken || typeof customToken !== 'string') {
            console.error('Invalid custom token returned from Firebase Admin SDK');
            return res.status(500).json({
                success: false,
                error: 'Failed to generate valid custom token'
            });
        }
        
        // Validate JWT structure (should have 3 parts)
        const jwtParts = customToken.split('.');
        if (jwtParts.length !== 3) {
            console.error(`Invalid JWT structure: expected 3 parts, got ${jwtParts.length}`);
            console.error('Token preview:', customToken.substring(0, 100));
            return res.status(500).json({
                success: false,
                error: 'Custom token has invalid JWT structure'
            });
        }
        
        console.log(`Custom token created for user: ${decodedToken.email} (${decodedToken.uid})`);
        console.log(`Custom token length: ${customToken.length}`);
        console.log(`Custom token preview (first 50 chars): ${customToken.substring(0, 50)}...`);
        console.log(`JWT parts count: ${jwtParts.length}`);
        
        // Ensure token doesn't have any unexpected characters that could corrupt it
        if (customToken.includes('\n') || customToken.includes('\r') || customToken.includes(' ')) {
            console.warn('Warning: Custom token contains unexpected whitespace characters');
        }
        
        res.json({
            success: true,
            customToken: customToken
        });
    } catch (error) {
        console.error('Error creating custom token:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create custom token'
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error middleware caught:', error);
    if (error instanceof multer.MulterError) {
        console.error('Multer error:', error.code, error.message);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 100MB.'
            });
        }
        return res.status(400).json({
            success: false,
            error: `Upload error: ${error.message}`
        });
    }
    console.error('Error stack:', error.stack);
    res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
    });
});

// Listen on all interfaces (0.0.0.0) to accept connections from Docker host
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
========================================`);
    console.log(`Social Platform Server`);
    console.log(`========================================`);
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Accessible at: http://kttc-dockerhost.kttc.local:${PORT}`);
    console.log(`Frontend: http://kttc-dockerhost.kttc.local:${PORT}/`);
    console.log(`API Base: http://kttc-dockerhost.kttc.local:${PORT}/api`);
    console.log(`Upload directory: ${UPLOAD_DIR}`);
    console.log(`Health check: http://kttc-dockerhost.kttc.local:${PORT}/api/health`);
    console.log(`Custom token endpoint: http://kttc-dockerhost.kttc.local:${PORT}/api/create-custom-token`);
    console.log(`========================================
`);
});

